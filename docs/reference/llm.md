# LLM Provider Reference (authoritative)

Source of truth: official provider docs (OpenAI preferred for MVP). This page captures JSON/structured output, endpoints, and usage patterns.

## Requirements
- Structured JSON output with a validated schema.
- Token usage reporting and limits; budgeting by day.
- Reasonable latency and throughput; retries on 429/5xx.

## Interface (implementation‑agnostic)
- `summarize_map(chunks: List[Chunk]) -> List[PartialJSON]`
- `summarize_reduce(partials: List[PartialJSON]) -> FinalJSON`
- Configurable: model name, max tokens, temperature, system prompt, JSON mode.

## OpenAI (Structured Outputs)
- Structured outputs (overview) — https://openai.com/index/introducing-structured-outputs-developer-preview/
- Cookbook examples (official) — https://github.com/openai/openai-cookbook

Usage pattern (Responses API with JSON/Schema):
```python
from openai import OpenAI
client = OpenAI()

schema = {
  "name": "digest_schema",
  "schema": {
    "type": "object",
    "properties": {
      "summary": {"type": "array", "items": {"type": "string"}},
      "feature_requests": {"type": "array", "items": {"type": "object"}},
      "bugs": {"type": "array", "items": {"type": "object"}},
      "unresolved": {"type": "array", "items": {"type": "object"}}
    },
    "required": ["summary", "feature_requests", "bugs", "unresolved"]
  }
}

resp = client.responses.create(
  model="gpt-4o-mini",  # example; pick per cost/quality
  messages=[
    {"role":"system","content":"You are a product triage analyst... Return only valid JSON."},
    {"role":"user","content":"<batched messages here>"}
  ],
  response_format={"type":"json_schema", "json_schema": schema}
)

data = resp.output_parsed  # provider returns JSON per schema
```

Notes
- Use conservative token limits, chunk inputs, and map→reduce.
- Validate the JSON against the schema; handle incomplete outputs with retries.

## Alternatives
- Azure OpenAI: same semantics via Azure endpoints.
- Anthropic: Claude structured output with its JSON guidance (prompting differs); ensure schema validation on our side.

