# NATS UK AIP ENR 5.1 UAS Flight Restrictions dataset

Status: **open question**. Redistribution terms have not been confirmed.

## What the dataset is

The UAS Flight Restrictions digital dataset (AIXM 5.1 plus a KML for visual
validation) published by NATS AIS on behalf of the CAA at
<https://nats-uk.ead-it.com/cms-nats/opencms/en/Publications/digital-datasets/index.html>,
refreshed every AIRAC cycle (28 days).

## What the pages say

The dataset pages carry "© Copyright NATS Limited" and no explicit reuse
licence. The UAS restriction zones page says the datasets were "created to
allow end users the ability to view the data in separate viewers or integrate
with other applications". No commercial-use or redistribution statement was
found on 2026-09-25.

## How this project uses it

- Parsed into the data pack at build time and redistributed as GitHub Release
  assets so that `npx` users need no NATS account or download of their own.
- Every response that uses the layer carries the attribution string
  "Airspace restrictions: UK AIP ENR 5.1 UAS Flight Restrictions dataset
  © NATS Limited. Reproduced for information only; the UK AIP is the
  authoritative source."
- The build supports `--exclude nats` so a pack without the layer can be
  published if redistribution is refused; the server would then fetch and parse
  the dataset client-side on first run (parser lives in `pipeline/sources/nats`).

## Correspondence log

| Date | Action |
|---|---|
| 2026-09-25 | Terms reviewed; none published. Enquiry to NATS AIS still to be sent. |
