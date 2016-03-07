var _ = require('lodash');
var fs = require('fs');
var os = require('os');
var path = require('path');
var util = require('util');
var assert = require('assert');
var request = require('superagent');

var Connector = require('loopback-connector').Connector;

var curlify = require('request-as-curl');
var debug = require('debug')('loopback:connector:mollie');

/**
 * Export the Mollie class.
 */

module.exports = Mollie;

/**
 * Create an instance of the connector with the given `settings`.
 */

function Mollie(settings, dataSource) {
    Connector.call(this, 'mollie', settings);
    
    assert(typeof settings === 'object', 'cannot initialize Mollie without a settings object');
    assert(typeof settings.apikey === 'string', 'cannot initialize Mollie without an API key');
    
    if (settings.rejectUnauthorized === false) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    
    this.debug = Boolean(settings.debug || debug.enabled);
    this.mock = Boolean(settings.mock);
    
    this.config = {};
    this.config.endpoint = settings.endpoint || 'https://api.mollie.nl';
    this.config.version = settings.version || 'v1';
    this.config.key = settings.apikey;
    
    this.settings = _.extend({}, settings, this.config);
    
    // See: https://www.mollie.com/nl/docs/paylinks
    this.config.paylink = settings.paylink || 'https://www.mollie.com/xml/ideal';
    this.config.partnerid = settings.partnerid;
    this.config.profile_key = settings.profile_key;
    
    if (_.isString(settings.cert)) {
        this.cert = fs.readFileSync(settings.cert);
    } else if (settings.cert === true) {
        this.cert = fs.readFileSync(path.join(__dirname, '..', 'data', 'certdata.txt'));
    }
    
    this.clientInfo = [os.type(), os.release(), os.platform(), os.arch(), os.hostname()].join(' ');
    
    if (this.debug) debug('config: %j', this.config);
    
    if (this.mock) this.mockRequest();
};

util.inherits(Mollie, Connector);

Mollie.version = '1.0.3';

Mollie.initialize = function(dataSource, callback) {
    var connector = new Mollie(dataSource.settings);
    dataSource.connector = connector; // Attach connector to dataSource
    connector.dataSource = dataSource; // Hold a reference to dataSource
    process.nextTick(callback);
};

Mollie.prototype.getEndpoint = function() {
    return this.endpoint || this.config.endpoint;
};

Mollie.prototype.setEndpoint = function(endpoint) {
    this.endpoint = !_.isEmpty(endpoint) ? endpoint : null;
    return this.endpoint;
};

Mollie.prototype.resetEndpoint = function() {
    return this.setEndpoint();
};

Mollie.prototype.mockRequest = function() {
    var config = require('./mock-config')(this, this.settings);
    this.requestMock = require('superagent-mock')(request, config);
};

Mollie.prototype.request = function(method, resource, idOrdata, subResource, options) {
    var url = this.getEndpoint() + '/' + this.config.version + '/' + resource;
    if (_.isString(idOrdata)) url += '/' + idOrdata;
    if (_.isString(subResource)) url += '/' + subResource;
    
    var req = request(String(method).toUpperCase(), url);
    req.set('Accept', 'application/json');
    req.set('Authorization', 'Bearer ' + this.config.key);
    req.set('User-Agent', 'Mollie/' + this.constructor.version + ' Node/' + process.version);
    req.set('X-Mollie-Client-Info', this.clientInfo);
    
    if (this.cert && method !== 'get') req.ca(this.cert);
    
    if (_.isObject(idOrdata)) req.send(idOrdata);
    
    if (_.isObject(options)) {
        var q = {};
        if (_.isNumber(options.offset)) {
            q.offset = options.offset;
        } else if (_.isNumber(options.skip)) {
            q.offset = options.skip;
        }
        if (_.isNumber(options.limit)) {
            q.count = options.limit;
        }
        if (!_.isEmpty(q)) req.query(q);
    }
    
    if (this.debug) req.on('response', debugResponse);
    
    return req;
};

Mollie.prototype.getLink = function(options, callback) {
    // See: https://www.mollie.com/nl/docs/paylinks
    options = _.extend({}, options);
    if (_.isNumber(options.amount) && !_.isEmpty(options.description)) {
        var query = _.omit(options, 'amount', 'partnerid', 'profile_key');
        query.partnerid = options.partnerid || this.config.partnerid;
        if (options.profile_key || this.config.profile_key) {
            query.profile_key = options.profile_key || this.config.profile_key;
        }
        query.amount = Math.round(options.amount * 100); // from float to cents
        var req = request.get(this.config.paylink);
        req.set('User-Agent', 'Mollie/' + this.constructor.version + ' Node/' + process.version);
        req.query(_.extend(query, { a: 'create-link' }));
        if (this.debug) req.on('response', debugResponse);
        req.end(function(err, res) {
            if (err) return callback(err);
            var matches = res.text.match(/<URL>([^<]+)<\/URL>/i);
            if (matches && matches[1]) {
                callback(null, matches[1]);
            } else {
                matches = res.text.match(/<message>([^<]+)<\/message>/i);
                var msg = (matches && matches[1]) || 'Failed to get link';
                callback(new Error(msg));
            }
        });
    } else {
        callback(new Error('Invalid link options'));
    }
};

/**
 * Create a new model instance
 * @param {Function} callback - you must provide the created model's id to the callback as an argument
 */
Mollie.prototype.create = function (model, data, callback) {
    var req = this.request('post', 'payments', this.toData(model, data));
    req.end(function(err, res) {
        if (err) return callback(normalizeError(err));
        callback(null, res.body && res.body.id);
    });
};
 
/**
 * Save a model instance
 */
Mollie.prototype.save = function (model, data, callback) {
    callback(new Error('Not Implemented'));
};

/**
 * Check if a model instance exists by id
 */
Mollie.prototype.exists = function (model, id, callback) {
    this.find(model, id, function(err, data) {
        callback(err, err ? false : (data ? true : false));
    });
};

/**
 * Find a model instance by id
 * @param {Function} callback - you must provide an array of results to the callback as an argument
 */
Mollie.prototype.find = function find(model, id, callback) {
    var connector = this;
    var req = this.request('get', 'payments', id);
    req.end(function(err, res) {
        if (err) return callback(normalizeError(err));
        callback(null, _.isEmpty(res.body) ? null : connector.fromData(model, res.body));
    });
};


/**
 * Delete a model instance by id
 */
Mollie.prototype.destroy = function destroy(model, id, callback) {
    callback(new Error('Not Implemented'));
};

/**
 * Query model instances by the filter
 */
Mollie.prototype.all = function all(model, filter, callback) {
    filter = filter || {};
    var idName = this.idName(model);
    if (filter.where && _.isString(filter.where[idName])) {
        this.find(model, filter.where[idName], function(err, item) {
            callback(err, (err || !item) ? [] : [item]);
        });
    } else if (_.isEmpty(filter.where)) {
        var connector = this;
        var req = this.request('get', 'payments', null, null, filter);
        req.end(function(err, res) {
            if (err) return callback(normalizeError(err));
            var items = _.map(res.body.data || [], function(item) {
                return connector.fromData(model, item);
            });
            callback(null, items);
        });
    } else {
        callback(new Error('Not Implemented'));
    }
};

/**
 * Delete all model instances
 */
Mollie.prototype.destroyAll = function destroyAll(model, where, callback) {
    callback(new Error('Not Implemented'));
};

/**
 * Count the model instances by the where criteria
 */
Mollie.prototype.count = function count(model, callback, where) {
    var req = this.request('get', 'payments');
    req.query({ count: 1 });
    req.end(function(err, res) {
        if (err) return callback(normalizeError(err));
        callback(null, res.body.totalCount || 0);
    });
};

/**
 * Update the attributes for a model instance by id
 */
Mollie.prototype.updateAttributes = function updateAttrs(model, id, data, callback) {
    callback(new Error('Not Implemented'));
};

/**
 * Convert the data to JSON
 */
Mollie.prototype.toData = function (model, data) {
    if (!_.isObject(data)) return {};
    var Model = this.dataSource.models[model];
    if (Model) {
        data = _.pick(data, _.keys(Model.definition.properties));
        data = _.omit(data, 'details');
    }
    return data;
};

/**
 * Parse the raw JSON data from the request
 */
Mollie.prototype.fromData = function (model, data) {
    if (!_.isObject(data)) return {};
    if (_.isEmpty(data.details)) delete data.details;
    _.each(data, function(v, k) {
        if (String(k).indexOf('Datetime') > -1) {
            data[k] = new Date(v);
        } else if (String(k).indexOf('Period') > -1) {
            data[k] = minutesFromIsoDuration(v);
        } else if (String(k).indexOf('amount') === 0) {
            data[k] = parseFloat(v);
        }
    });
    return data;
};

Mollie.prototype.normalizeError = normalizeError;

var durationRegex = /P((([0-9]*\.?[0-9]*)Y)?(([0-9]*\.?[0-9]*)M)?(([0-9]*\.?[0-9]*)W)?(([0-9]*\.?[0-9]*)D)?)?(T(([0-9]*\.?[0-9]*)H)?(([0-9]*\.?[0-9]*)M)?(([0-9]*\.?[0-9]*)S)?)?/

function minutesFromIsoDuration(duration) {
    var matches = String(duration).match(durationRegex);
    return matches ? (parseFloat(matches[14]) || 0) : 0;
};

function normalizeError(err) {
    if (err instanceof Error && _.isObject(err.response)
        && _.isObject(err.response.body) && _.isObject(err.response.body.error)) {
        err.message = err.response.body.error.message || err.message;
        err.details = err.response.body.error;
        delete err.response;
        delete err.original;
    }
    return err;
};

function debugResponse(response) {
    var req = response.req;
    var base = req.protocol + '://' + req.host + '/';
    var data = req._formData || req._data || {};
    req.headers = req._headers || {};
    var curled = curlify(req, data);
    debug('request: %s', curled);
};