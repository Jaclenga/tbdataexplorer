import { z } from "zod";
import dictionary from "../../../config/categories.json";
import overrides from "../../../config/category-overrides.json";
import type { Dataset } from "../../types";

const ruleSchema = z.object({
  requiresTitle: z.boolean().default(false),
  keywords: z.array(z.string()),
  phrases: z.array(z.string()),
  contextPhrases: z.array(z.string()).default([]),
});
export const categorizationConfigSchema = z.object({
  version: z.string().min(1),
  minimumScore: z.number().positive(),
  minimumMargin: z.number().positive(),
  highScore: z.number().positive(),
  highMargin: z.number().positive(),
  titleCap: z.number().positive(),
  contextCap: z.number().positive(),
  weights: z.object({
    titleKeyword: z.number().positive(),
    titlePhrase: z.number().positive(),
    titlePhraseExtraWord: z.number().nonnegative(),
    tags: z.number().positive(),
    description: z.number().positive(),
    source_category: z.number().positive(),
    fields: z.number().positive(),
    parent_context: z.number().nonnegative(),
  }),
  fieldCaps: z.object({
    tags: z.number().positive(),
    description: z.number().positive(),
    source_category: z.number().positive(),
    fields: z.number().positive(),
    parent_context: z.number().nonnegative(),
  }),
  stopwords: z.array(z.string()),
  aliases: z.record(z.string(), z.string()),
  categories: z.record(z.string(), ruleSchema),
});
export const categoryConfig = categorizationConfigSchema.parse(dictionary);
export const categoryNames = [
  ...Object.keys(categoryConfig.categories),
  "Uncategorized",
];
export const categoryOverrides = z
  .record(z.string(), z.string())
  .parse(overrides);
for (const value of [
  ...Object.values(categoryConfig.aliases),
  ...Object.values(categoryOverrides),
])
  if (!categoryNames.includes(value))
    throw Error(`Unknown configured category: ${value}`);

type Metadata = Pick<
  Dataset,
  "title" | "description" | "tags" | "category" | "fields" | "category_metadata"
>;
export interface Prediction {
  category: string;
  tier: "high" | "medium" | "low";
  signals: string[];
  review: "ambiguous" | "insufficient" | null;
  scores: { category: string; score: number }[];
}
function stem(word: string) {
  if (word.endsWith("ies") && word.length > 4) return word.slice(0, -3) + "y";
  return word.length > 3 && /s$/.test(word) && !/(ss|us)$/.test(word)
    ? word.slice(0, -1)
    : word;
}
export function normalizeMetadata(value: string) {
  return (
    value
      .replace(/<[^>]*>/g, " ")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([a-zA-Z])(\d)/g, "$1 $2")
      .replace(/(\d)([a-zA-Z])/g, "$1 $2")
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      // Publisher abbreviations, expanded only at word boundaries.
      .replace(/\bww\s*treatment\b/g, "wastewater treatment")
      .replace(/\bwwtp\b/g, "wastewater treatment plant")
      .replace(/\brow\b/g, "right of way")
      .replace(/\badu\b/g, "accessory dwelling unit")
      .replace(/\bflu\b/g, "future land use")
      .replace(/\bcwp\b/g, "countywide plan")
      .replace(/\bbfe\b/g, "base flood elevation")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(stem)
      .join(" ")
  );
}
const stopwords = new Set(categoryConfig.stopwords.map(normalizeMetadata));
const rules = Object.entries(categoryConfig.categories).map(
  ([category, rule]) => ({
    category,
    requiresTitle: rule.requiresTitle,
    keywords: rule.keywords.map((signal) => ({
      signal,
      term: normalizeMetadata(signal),
    })),
    phrases: rule.phrases.map((signal) => ({
      signal,
      term: normalizeMetadata(signal),
    })),
    contextPhrases: rule.contextPhrases.map(normalizeMetadata),
  }),
);
const canonical = new Map(
  [...Object.keys(categoryConfig.categories), "Uncategorized"].map((name) => [
    normalizeMetadata(name),
    name,
  ]),
);
for (const [alias, name] of Object.entries(categoryConfig.aliases))
  canonical.set(normalizeMetadata(alias), name);
export function canonicalCategory(value: string | null | undefined) {
  return value
    ? (canonical.get(
        normalizeMetadata(value.replace(/^\/Categories\//i, "")),
      ) ?? null)
    : null;
}
function fieldsFor(dataset: Metadata) {
  return {
    title: normalizeMetadata(dataset.title.slice(0, 1000)),
    tags: normalizeMetadata(
      dataset.tags
        .slice(0, 50)
        .map((t) => t.slice(0, 128))
        .join(" "),
    ),
    description: normalizeMetadata((dataset.description ?? "").slice(0, 4000)),
    parent_context: normalizeMetadata(
      dataset.category_metadata
        ? `${dataset.category_metadata.itemSummary} ${dataset.category_metadata.itemDescription} ${dataset.category_metadata.itemTags.join(" ")}`.slice(
            0,
            4000,
          )
        : "",
    ),
    source_category: normalizeMetadata((dataset.category ?? "").slice(0, 512)),
    fields: normalizeMetadata(
      (dataset.fields ?? [])
        .slice(0, 64)
        .map((f) => f.name + " " + (f.alias ?? ""))
        .join(" "),
    ),
  };
}
function matches(text: string, rule: (typeof rules)[number]) {
  const phrases = rule.phrases.filter((p) =>
    (" " + text + " ").includes(" " + p.term + " "),
  );
  const tokens = new Set(text.split(" ").filter((t) => !stopwords.has(t)));
  const words = rule.keywords.filter(
    (k) =>
      tokens.has(k.term) &&
      !phrases.some((p) => p.term.split(" ").includes(k.term)),
  );
  return { phrases, words };
}
function scoreRule(
  fields: ReturnType<typeof fieldsFor>,
  rule: (typeof rules)[number],
) {
  let title = 0,
    context = 0;
  const contextSignals = rule.contextPhrases.flatMap((phrase) =>
    (["description", "fields"] as const)
      .filter((field) => ` ${fields[field]} `.includes(` ${phrase} `))
      .map((field) => `${field}:context:${phrase}`),
  );
  const signals: string[] = [];
  for (const [field, text] of Object.entries(fields)) {
    const hits = matches(text, rule);
    if (field === "title")
      title = Math.min(
        categoryConfig.titleCap,
        hits.phrases.reduce(
          (sum, phrase) =>
            sum +
            categoryConfig.weights.titlePhrase +
            Math.max(0, phrase.term.split(" ").length - 2) *
              categoryConfig.weights.titlePhraseExtraWord,
          0,
        ) +
          hits.words.length * categoryConfig.weights.titleKeyword,
      );
    else {
      const key = field as keyof typeof categoryConfig.fieldCaps;
      context += Math.min(
        categoryConfig.fieldCaps[key],
        (hits.phrases.length + hits.words.length) * categoryConfig.weights[key],
      );
    }
    for (const hit of [...hits.phrases, ...hits.words])
      signals.push(`${field}:${hit.signal}`);
  }
  return {
    category: rule.category,
    score:
      rule.requiresTitle && title === 0 && contextSignals.length === 0
        ? 0
        : title +
          Math.min(categoryConfig.contextCap, context) +
          (contextSignals.length ? 6 : 0),
    signals: [...new Set([...signals, ...contextSignals])].sort(),
  };
}
export function predictCategory(dataset: Metadata): Prediction {
  const fields = fieldsFor(dataset);
  const scored = rules
    .map((rule) => scoreRule(fields, rule))
    .sort((a, b) => b.score - a.score || (a.category < b.category ? -1 : 1));
  const winner = scored[0],
    margin = winner.score - scored[1].score;
  const review =
    winner.score < categoryConfig.minimumScore
      ? "insufficient"
      : margin < categoryConfig.minimumMargin
        ? "ambiguous"
        : null;
  return {
    category: review ? "Uncategorized" : winner.category,
    tier: review
      ? "low"
      : winner.score >= categoryConfig.highScore &&
          margin >= categoryConfig.highMargin
        ? "high"
        : "medium",
    signals: review
      ? scored
          .filter((s) => s.score > 0)
          .slice(0, 2)
          .flatMap((s) => s.signals)
          .sort()
      : winner.signals,
    review,
    scores: scored.map(({ category, score }) => ({ category, score })),
  };
}
