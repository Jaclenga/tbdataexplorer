import { describe, expect, it } from "vitest";
import config from "../../config/semantic-categories.json";
import {
  entailmentScore,
  semanticDecision,
  semanticKey,
  semanticText,
} from "../../scripts/semantic-categorization";
import { dataset } from "../fixtures";
const scores = (first: number, second: number) =>
  Object.keys(config.categories).map((category, i) => ({
    category,
    score: i === 0 ? first : i === 1 ? second : 0.01,
  }));
describe("semantic fallback", () => {
  it("does not mistake neutral evidence for strong entailment", () => {
    expect(entailmentScore([-5, -1, 5], 1)).toBeLessThan(0.01);
    expect(entailmentScore([-5, 5, -1], 1)).toBeGreaterThan(0.99);
    expect(() => entailmentScore([NaN, 0, 0], 1)).toThrow();
  });
  it("accepts strong separated evidence and abstains on weak or competing labels", () => {
    expect(semanticDecision(scores(0.95, 0.2)).accepted).toBe(true);
    expect(semanticDecision(scores(0.8, 0.1)).accepted).toBe(false);
    expect(semanticDecision(scores(0.95, 0.9)).accepted).toBe(false);
  });
  it("rejects malformed, duplicate or noncanonical predictions", () => {
    expect(() => semanticDecision(scores(NaN, 0.2))).toThrow();
    expect(() => semanticDecision([{ category: "Typo", score: 1 }])).toThrow();
    const duplicate = scores(0.9, 0.2);
    duplicate[1].category = duplicate[0].category;
    expect(() => semanticDecision(duplicate)).toThrow();
  });
  it("invalidates cached evidence when metadata changes and excludes generated categories", () => {
    const text = semanticText(dataset);
    const recategorized = { ...dataset, category: "Housing" };
    expect(semanticText(recategorized)).toBe(text);
    expect(
      semanticKey(
        semanticText({ ...dataset, description: "Different subject" }),
      ),
    ).not.toBe(semanticKey(text));
    expect(semanticKey(text)).toBe(semanticKey(text));
  });
});
