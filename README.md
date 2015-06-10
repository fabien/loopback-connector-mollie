# Payment flow:

1. A consumer on your website decides to checkout.

2. Your website creates a payment on the Mollie platform by calling the Mollie
API with the amount, a payment description and a URL we should redirect the
consumer to after the payment is made.

3. The API responds with the unique id and the paymentUrl for the newly created
payment. Your website stores the id, links it to the customers order and
redirects the consument to the paymentUrl from the Mollie API response. This
is the URL to the payment screen for this specific payment.

4. The consumer reaches the Mollie payment screen, chooses a payment method and
makes the payment. This process is entirely taken care of by Mollie. You don't
need to do anything here.

5. When the payment is made Mollie will call your Webhook informing your website
about the payments status change. You can configure a generic webhook in your
Dashboard or define one per-payment when creating the payment.

6. In response to you webhook being called your website just needs to issue a 200
OK status. From that response Mollie can tell that your processing the new
status was successful – for any other response we keep trying.

7. Processing the webhook request your website fetches the payment status using
the Mollie API. This fetched status serves to mark the order as paid, trigger
fulfilment and send out an email confirmation to the customer.

8. At this point Mollie returns the visitor to your website. Your website knows
the payment was successful and thanks the consumer.