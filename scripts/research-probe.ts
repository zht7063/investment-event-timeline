/** Read-only capability probe. No DB writes, model calls, credentials or licensed content in output. */
import {
  fetchPage,
  publishedDay,
  resolveInstrument,
} from "../src/server/research/providers";
import {
  ResearchInput,
  SOURCE_LABEL,
  type SourceId,
} from "../src/domain/research";
const input = ResearchInput.parse({
  code: process.argv[2] || "300308.SZ",
  start: process.argv[3] || "2026-09-01",
  end: process.argv[4] || "2026-09-07",
});
const instrument = await resolveInstrument(input.code);
console.log(JSON.stringify({ instrument, start: input.start, end: input.end }));
for (const source of Object.keys(SOURCE_LABEL) as SourceId[]) {
  try {
    const first = await fetchPage(source, instrument, input, "first");
    const dates = first.items.map((i) => publishedDay(i.publishedAt));
    console.log(
      JSON.stringify({
        source,
        items: first.items.length,
        invalid: first.invalid,
        inside: dates.filter((d) => d && d >= input.start && d <= input.end)
          .length,
        outside: dates.filter((d) => d && (d < input.start || d > input.end))
          .length,
        unknownDates: dates.filter((d) => !d).length,
        hasNext: Boolean(first.next),
        exhausted: first.exhausted,
      }),
    );
    if (source === "fuyao-news" && first.next) {
      const second = await fetchPage(source, instrument, input, first.next);
      const keys = new Set(first.items.map((i) => i.key));
      console.log(
        JSON.stringify({
          source,
          page: 2,
          items: second.items.length,
          overlap: second.items.filter((i) => keys.has(i.key)).length,
          cursorAdvanced: second.next !== first.next,
          exhausted: second.exhausted,
        }),
      );
    }
  } catch (error) {
    console.log(
      JSON.stringify({
        source,
        error: error instanceof Error ? error.name : "UnknownError",
        status: "failed",
      }),
    );
    process.exitCode = 1;
  }
}
