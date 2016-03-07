var _ = require('lodash');

module.exports = function(connector, options) {
    options = options || {};
    var payments = {}; // mock storage
    
    if (!_.isFunction(connector.mockResponse)) {
        connector.mockResponse = _mockResponse.bind(connector);
    }
    
    if (!_.isFunction(connector.mockRedirectUrl)) {
        connector.mockRedirectUrl = _mockRedirectUrl.bind(connector);
    }
    
    return [{
        pattern: options.endpoint + '/v1/payments/([a-zA-Z0-9_]+)',
        fixtures: function(match, params, headers) {
            return params;
        },
        get: function(match, params, headers) {
            var id = match[1];
            var payment = payments[id];
            if (payment) return { code: 200, body: payment };
            return { code: 404 };
        }
    }, {
        pattern: options.endpoint + '/v1/payments',
        fixtures: function(match, params, headers) {
            return params;
        },
        get: function(match, params, headers) {
            var list = { totalCount: payments.length, offset: 0, count: payments.length };
            list.data = _.values(payments);
            return { code: 200, body: list };
        },
        post: function(match, params, headers) {
            var id = randomString(10, 'aA#');
            var payment = connector.mockResponse(id, 'open', params);
            payments[payment.id] = payment;
            return { code: 201, body: payment };
        }
    }];
    
    function _mockResponse(id, status, params) {
        params.metadata = params.metadata || {};
        var response = {
            id: 'tr_' + id,
            mode: 'test',
            createdDatetime: new Date().toISOString(),
            status: status,
            expiryPeriod: 'PT15M',
            amount: params.amount || 0,
            description: params.description || '',
            metadata: params.metadata,
            links: {
                paymentUrl: 'https://www.mollie.com/payscreen/pay/' + id,
                redirectUrl: connector.mockRedirectUrl(params, options)
            }
        };
        if (status === 'paid') delete response.expiryPeriod;
        if (_.isFunction(options.mockResponse)) options.mockResponse(id, status, params);
        return response;
    };
    
    function _mockRedirectUrl(params, options) {
        if (_.isFunction(options.mockRedirectUrl)) {
            return options.mockRedirectUrl(params, options);
        } else if (_.isString(options.mockRedirectUrl)) {
            return options.mockRedirectUrl;
        } else {
            return 'http://localhost/orders/' + params.metadata.id;
        }
    };
    
    function randomString(length, chars) {
        var mask = '';
        if (chars.indexOf('a') > -1) mask += 'abcdefghijklmnopqrstuvwxyz';
        if (chars.indexOf('A') > -1) mask += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        if (chars.indexOf('#') > -1) mask += '0123456789';
        if (chars.indexOf('!') > -1) mask += '~`!@#$%^&*()_+-={}[]:";\'<>?,./|\\';
        var result = '';
        for (var i = length; i > 0; --i) result += mask[Math.floor(Math.random() * mask.length)];
        return result;
    };
    
};
