# Korean memory retrieval fixture

`korean-retrieval.json` contains 24 synthetic, active user memories and 88 Korean queries. The content is dedicated to the public domain under CC0-1.0. No actual user conversation or personal information is included.

Each split has 24 related queries and 20 unrelated queries. `relevant` lists memory IDs that can answer the question; an empty list means that none of the stored memories contains the requested fact. Some unrelated queries deliberately mention a known topic while asking for an unknown detail. Retrieving a memory about a cat's name does not answer its birthday.

The fixture covers particles, inflected forms, paraphrases, preferences, explicit negation, changed residence/travel plans, quoted text, and emoji. Negated or corrected facts stay in their original whole memory. The quotation case records the difference between a writing exercise and an actual preference. Deleted memory versions, stale indexing responses, source offsets, and transaction rollback are storage/protocol regressions and are tested separately in Rust.

Use the exact profile's `query: ` and `passage: ` preprocessing, tokenizer, pooling, normalization, and quantized artifact. Search returns at most 20 semantic candidates before ranking fusion and at most 8 final memories. Compute retrieval metrics at 5 from the final ranked result.

- On `calibration`, choose the cosine threshold with the highest mean `Recall@5` among thresholds whose unrelated-query false positive rate is at most 5%. Break equal scores by the stricter threshold.
- Freeze that threshold with the model fingerprint. Evaluate `evaluation` only after selecting the threshold; do not tune the threshold using this split.
- Per related query, `Recall@5 = |top 5 IDs intersect relevant IDs| / |relevant IDs|`. Report the mean across related queries.
- An unrelated query is a false positive if the retrieval output contains any memory. The false positive rate is the number of such queries divided by the number of unrelated queries. With 20 unrelated queries per split, one false positive is 5%.
- Report semantic-only and the actual lexical/Kiwi/semantic combined path separately. A passing semantic threshold cannot establish that the combined path passes the unrelated-query target.

The release goals are `Recall@5 >= 90%` and unrelated-query false positives `<= 5%`. This small synthetic fixture is a reproducible regression and calibration starting point, not a representative population benchmark. Calibration and evaluation share the same memory corpus and related topics; the evaluation split tests unseen question wording, not generalization to new users or topics. Add independently authored corpora before claiming broad Korean search quality.

No model has been run by the fixture creation step, no threshold is preselected here, and no measured accuracy or hardware performance is claimed. Save model revision/fingerprint, threshold, per-query results, aggregate metrics, and the execution environment with any actual run.
