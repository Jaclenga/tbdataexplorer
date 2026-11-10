# Metadata categories

The catalog uses TypeScript keyword and exact-phrase matching followed by a local semantic classifier for unresolved entries during generation, never during page rendering. The semantic model uses the Hugging Face Transformers.js development dependency and CPU inference. Its pinned public weights download once; metadata is not sent to a hosted inference API and no API key or paid service is required. Uncategorized is an explicit abstention.

## Configuration and priority

- `config/categories.json`: versioned dictionaries, aliases, stopwords, weights, caps and score thresholds.
- `config/category-overrides.json`: stable dataset ID to canonical category. An explicit Uncategorized override is allowed.
- `config/semantic-categories.json`: pinned model revision, descriptions for every category, semantic acceptance thresholds and version.
- Priority: explicit override, existing curated category, recognized publisher category, previously trusted assignment, keyword NLP, semantic fallback, Uncategorized. Previous automatic predictions are recomputed or retrieved from a matching metadata cache. Removing an override intentionally returns that dataset to normal classification.
- `public/catalog.json` and the CRAN package list are never modified by categorization. Checked categories and explicit overrides are delivered in discovery's curatedUpdates.

Existing canonical names and publisher aliases are normalized. Unrecognized source categories remain in source_category as evidence rather than creating extra filter values. The manual overrides currently correct two reviewed records: Median_Age_of_Housing_(Years) concerns housing stock, and ParcelEvacuation concerns evacuation rather than parcel development. Their stable IDs are taken from the actual discovered catalog.

Title keywords score 8, title phrases 12 plus 4 for each word beyond two, capped at 24. This gives specific phrases such as water control valve more evidence than broad terms. Tags score 3 per concept (cap 6), source categories 2 (cap 4), descriptions and field names 1 (cap 2 each). All context combined is capped at 6. Repeated words do not add scores; phrase components are not counted again as keywords in that field. Normalization handles punctuation, HTML, CamelCase, letter/digit boundaries, accents and simple plurals. WWTreatment and WWTP expand to wastewater treatment and wastewater treatment plant; ROW, ADU and FLU expand to right of way, accessory dwelling unit and future land use. Generic city/county/data words cannot determine categories. Parent item context scores 0.5 per concept, capped at 1. Reviewed contextPhrases add a single six-point bonus when found in a layer description or field alias. Planning requires either a title signal or a specific reviewed context phrase because several actual services repeat land-use boilerplate across unrelated layers. Lake alone is excluded because it often appears in place names.

A winner needs score >=6 and a margin >=2. A high tier requires score >=12 and margin >=4; other accepted predictions are medium. Insufficient or tied evidence yields Uncategorized with a low tier. Tiers are rule-strength labels, **not calibrated probabilities**. Trusted assignments use high to reflect their authoritative source. A generic publisher Uncategorized value does not prevent classification.

Provenance fields: category_source, category_confidence, category_version, category_signals, category_review, source_category. Details are available in catalog JSON, review reports and the expanded dataset details. Collapsed rows and existing category filters use the ordinary category field; no AI badge is added.

## Run and review

```sh
npm run catalog:categorize
npm run category:evaluate
npm run category:evaluate -- --check
npm run discovery:refresh
```

The categorization command updates existing metadata and fetches missing category context from registered public ArcGIS publishers without changing source verification timestamps. It writes discovery metadata only if classifications change; semantic review and cache files are refreshed on every run. The scheduled daily refresh runs the same classifiers after discovery and before endpoint/catalog validation and publication. Every push and pull-request check also runs categorization before validation and builds. The upstream catalog workflow runs it after every scheduled, manual or pull-request generation. These check workflows upload categorized metadata and semantic reports for review; the daily discovery workflow commits validated metadata and semantic cache/review files. Model weights are cached under `.wrangler/models` in Actions. Model download or inference failures stop publication rather than silently skipping the fallback. Categories come only from validated configuration; invalid overrides stop publication. Source verification failures continue retaining previous datasets.

Dictionary version 1.3 adds specific layer-context phrases, CWP/BFE abbreviations, school-sidewalk primary-subject matching, and weaker parent-item evidence. Keyword minimum score and margin are unchanged.

## Semantic fallback

`Xenova/nli-deberta-v3-xsmall` runs with pinned quantized ONNX weights. It compares title, description, tags, original publisher category and field names/aliases against category descriptions using independent multi-label entailment scores. The current catalog still receives one primary category: the top score must be at least 0.85 and exceed the runner-up by at least 0.20. Competing labels therefore still abstain. These are uncalibrated model scores and heuristic thresholds, not probabilities of classification accuracy. Accepted assignments use `category_source: semantic`, medium confidence, and model/revision plus leading scores in their signals.

Unlike the standard multi-label pipeline's entailment-versus-contradiction normalization, this fallback includes the neutral logit in the softmax for every candidate category. This prevents tiny entailment and contradiction values from producing an apparently confident assignment when the model mainly predicts neutral. Categories are scored independently; the existing catalog stores one primary category.

Inputs are bounded (1,800 description characters, 30 tags and 30 fields) and subject to the model tokenizer's context limit. `reports/category-semantic-cache.json` stores all scores keyed by input text and the complete semantic configuration, including model revision and category descriptions. Metadata or configuration changes invalidate the cached input; previous model output is never used as publisher evidence. Unused cache entries are pruned. `reports/category-semantic-review.json` records every attempt, acceptance decision and category score. Manual Uncategorized overrides bypass semantic inference.

The model is a general language model, not trained or calibrated on this catalog. Review accepted assignments and add independently labeled examples before interpreting thresholds as an accuracy guarantee. `npm run category:semantic:evaluate` evaluates the combined keyword/semantic path on 13 reviewed development regression records in `tests/fixtures/semantic-evaluation.json`. Its report separates incorrect assignments from abstentions. Actions uses `--check` to check report drift and stops on incorrect assignments. These examples were selected while inspecting output and are not an independent accuracy estimate. The existing evaluation below measures keyword NLP only.

`reports/category-review.json` contains totals, assignment sources, distribution counts, ambiguous/insufficient records with their leading candidates and signals, and changed categories. Empty categories and categories exceeding 40% are flagged for review, not automatically rebalanced. Each scheduled attempt uploads `.wrangler/category-review.json` and includes counts in its Actions summary. The committed report describes the last published classification changes; the per-attempt artifact includes attempts with no catalog changes.

## Evaluation and limitations

`tests/fixtures/category-evaluation.json` snapshots 85 actual records: all 52 checked entries with existing curated labels, plus 33 manually reviewed discovered examples, including difficult and generic titles and 14 previously uncategorized examples added for version 1.1. Evaluation withholds source categories and bypasses overrides/curated priority to assess NLP alone. This is a **small development set**, used to inspect rules, not an independent holdout or estimate of accuracy across all publishers. Government has unit-test coverage but no labeled real examples in this set.

The measured result and every confusion case are in `reports/category-evaluation.json`. The remaining difficult cases are housing-stock age versus population age, and parcel evacuation's competing hazard/development evidence. Explicit reviewed overrides correct those two records in the published catalog without hiding them from the NLP evaluation. Broad or missing metadata still leaves many catalog records Uncategorized by design. Add reviewed examples before changing rules; increase category_version when dictionary behavior changes and rerun categorization and evaluation.

The evaluator also times 10,000 real metadata predictions and prints the measurement; timing is omitted from the committed report to avoid machine-specific diffs. On the development machine this took about 3 seconds. CI checks the deterministic evaluation report for drift. Unit tests cover every category, precedence, aliases, normalization, abstention, shared boilerplate, metadata updates, determinism and real catalog integration.

## Metadata enrichment, review and model comparison

Before the semantic fallback, categorization fetches missing item descriptions, summaries, tags, layer descriptions and field aliases from registered ArcGIS portal/service prefixes. Requests have 12-second deadlines, bounded concurrency and shared-item deduplication. Item identity and public access must match. Failed requests retain prior metadata. `category_metadata` stores separate parent/layer evidence and source URLs; endpoint verification dates are unchanged. Daily discovery refreshes previously enriched context at most once per UTC day, including records classified by the added context. Standalone categorization reuses saved evidence. Parent text cannot trigger the strong layer-context bonus.

School sidewalk records use Transportation as their main subject; schools remain searchable in titles and existing metadata. Records still lacking reliable evidence are listed in `reports/category-triage.json` with source links, descriptions, field aliases and candidate scores. `reports/category-enrichment.json` records request health and enriched totals.

`npm run category:benchmark` compares pinned DeBERTa and DistilBERT models on 23 frozen reviewed examples in `tests/fixtures/category-benchmark.json`. The title-hash split keeps repeated titles together: 12 tuning records and 11 validation records. It searches score thresholds 0.55–0.95 and margins 0.10–0.30 using only tuning data, then reports validation separately. Add `-- --refresh-metadata` to deliberately replace frozen inputs from current publisher metadata. The ignored local benchmark cache avoids repeated inference. Results, per-record scores, timings and deployment decisions are in `reports/category-benchmark.json`.

Neither model/threshold candidate improved correct validation assignments without errors in this small development comparison, so the existing model and 0.85/0.20 thresholds are retained. Lowering them is not supported by this evidence. These examples were selected during development, and contextual rules were improved from their wording; they are not an independent evaluation of the keyword classifier or a population accuracy estimate. Benchmark scores alone do not authorize rebalancing categories or forced assignment.