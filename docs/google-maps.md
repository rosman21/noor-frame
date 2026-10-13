# Google Maps for travel times

Travel works without a Google key. Noor uses OpenStreetMap and OSRM for free route estimates.
Add a Google Maps Platform key in the phone companion under **Travel times** for live driving
traffic, transit and cycling, plus home address validation and address suggestions.

## APIs to enable

Enable all three APIs in the Google Cloud project that owns your key:

1. **Routes API** — computes travel time and distance. Driving uses `TRAFFIC_AWARE` routing.
2. **Address Validation API** — checks the household's home address when you run the travel
   check.
3. **Places API (New)** — suggests addresses while you type the home address in the companion.

Google requires billing to be enabled for the project even when use stays within a free usage
cap. Create a separate key for Noor where practical, restrict it to the three APIs above, and
set per-API quotas and a budget alert in Google Cloud. A budget alert reports spending; it does
not stop API use by itself. The key is sent by the home server to Google
in a request header; it is encrypted when saved from the companion and never sent to a frame or
browser. A key placed in `frame.config.json` is plaintext in that file, so prefer the companion.

Noor's Google calls are server-side, so use an API restriction rather than a browser referrer
restriction. You can also restrict by the server's fixed public egress IP, if it has one. Keep
the key private and rotate it if it is exposed.

## Noor's daily request limit

`googleDailyLimit` defaults to **100 outgoing Google requests per household day** (range 0–5000).
The limit is shared by Routes, Address Validation and Places autocomplete. When it is reached,
Noor falls back to free OSRM estimates for travel until the household's local midnight. Set the
limit in the companion under **Travel times → Google lookups per day**.

The counter is stored by the server and is shared by screens using that server. It requires
writable server storage; on Cloudflare, bind a KV namespace (`FRAME_KV`) before relying on it.
Without storage, Noor cannot keep the count and allows calls. One Node.js server process
serializes updates to this counter. Multiple server processes or concurrent Cloudflare Worker
isolates can race while reading and writing the shared count, so treat Noor's limit as a usage
guard rather than a hard billing cap. Noor counts a request before sending it, so a failed
request may still use one place in Noor's cap. Google
bills according to successful billable requests and the SKU each request triggers. Route results
are cached by destination, travel mode and 15-minute departure slot; near-term results are
cached for 15 minutes and later trips for six hours. Places autocomplete waits until the user
pauses typing and has entered at least four characters. Noor sends an autocomplete session token,
but does not currently complete that session with a Place Details or Address Validation request
using the same token, so treat suggestions as per-request usage in cost estimates.

## What might it cost?

As checked in October 2026, Google's global monthly free usage caps are 5,000 successful requests
for Routes Compute Routes Pro (the `TRAFFIC_AWARE` driving SKU), 5,000 for Address Validation
Pro, and 10,000 for Places Autocomplete Requests. After each SKU's cap, the listed first paid
tier is $10, $17 and $2.83 per 1,000 requests, respectively. The price depends on the SKU and
region; see Google's [current global price list](https://developers.google.com/maps/billing-and-pricing/pricing)
and the API-specific [Routes](https://developers.google.com/maps/documentation/routes/usage-and-billing),
[Address Validation](https://developers.google.com/maps/documentation/address-validation/usage-and-billing)
and [Places](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing)
billing pages.

The **Check address and routes** button uses one Address Validation request plus one Routes
request when a home address is set, or one Routes request without one. Each suggestion request
while typing also uses one place in the shared cap.

With Noor's default 100-request daily limit, at most 3,100 requests can be counted in a 31-day
month, across all three APIs. If this project and billing account have no other usage consuming
those APIs' free caps, Noor's use should remain within them. Google aggregates usage across
projects on a billing account, so other applications can use the free cap first; the Noor limit
is not a Google Cloud billing cap and cannot protect against charges from other uses of the key.
Review Google Cloud billing and quota settings for the account that owns the key. A normal
alerts-only [Google Cloud budget](https://cloud.google.com/billing/docs/how-to/budgets) does not
automatically stop usage. Prices and free caps can change.

## If a request fails

- Confirm billing is enabled for the key's Google Cloud project.
- Confirm the three APIs above are enabled and the key's API restrictions include them.
- Check the companion's travel check result for the API name and Google error.
- Remove the key to return to free OpenStreetMap and OSRM estimates.

The household can also disable **Travel times** entirely in the companion. No Google calls are
made when travel is disabled or no key is saved.
