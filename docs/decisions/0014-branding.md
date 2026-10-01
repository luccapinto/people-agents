# ADR 0014: Branding in one file

Status: accepted (2026-09-30)

## Context
The product name is provisional.

## Decision
`config/branding.json` holds product name, tagline and fictional company data. The back-end
reads it through `atrium.branding`; the front-end imports it. Docs refer to the product by
name, which is a single search-and-replace.

## Alternatives rejected
- Environment variables: the name is not configuration that differs per environment.
