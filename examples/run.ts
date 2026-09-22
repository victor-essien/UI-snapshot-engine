import { analyze, GeminiExtractor } from "../src/index.js";

const { run, extractions } = await analyze({
  baseUrl: process.env.BASE_URL ?? "http://localhost:8080",
  routes: ["/", "/about", "/sustainability"],
  extractor: new GeminiExtractor(), // reads GEMINI_API_KEY
});

console.log(run.summary);
console.log(JSON.stringify(extractions, null, 2));
