import { describe, expect, it } from "vitest";
import {
  alignReturnSeries,
  ASSUMED_CORRELATION,
  averageOffDiagonal,
  buildCorrelationMatrix,
  correlationFromColumns,
  minEigenvalue,
  nearestPSDCorrelation,
  shrinkageIntensity,
  type ReturnObservation,
} from "../correlation";

/**
 * Three strategies over 36 months. A and B load on a common factor; C is
 * nearly independent of both. Expected correlations were computed with numpy.
 */
const A = [-0.000064, 0.010719, -0.009153, -0.024381, -0.011945, -0.026583, -0.002051, 0.036414, -0.009213, -0.021394, 0.015804, 0.009994, 0.000922, -0.019121, 0.001497, 0.015175, -0.036070, -0.010626, -0.051899, -0.032769, -0.049926, -0.004346, -0.029905, 0.005297, 0.004842, -0.006437, -0.067571, -0.018106, -0.003047, 0.002471, -0.038617, -0.009464, -0.030391, -0.024223, 0.030585, -0.027781];
const B = [-0.002749, 0.006586, 0.000963, -0.017238, -0.012875, -0.026011, -0.000058, 0.041306, -0.014381, -0.016713, 0.013872, 0.007841, 0.001346, -0.029016, -0.000771, 0.014026, -0.025264, -0.007064, -0.045774, -0.026939, -0.046241, 0.000671, -0.030451, 0.010011, -0.003983, -0.002406, -0.070531, -0.025141, -0.002991, -0.002680, -0.035739, 0.002002, -0.028475, -0.023156, 0.026694, -0.016423];
const C = [-0.005026, -0.005421, 0.019609, 0.013481, -0.030142, -0.003744, 0.001096, -0.028042, 0.006667, -0.025382, 0.028439, 0.006029, 0.002703, -0.018240, -0.003424, -0.055893, -0.034261, 0.009655, -0.063516, 0.022194, -0.052526, 0.021214, -0.025998, 0.022608, 0.003967, -0.044080, 0.031826, 0.040281, -0.001948, -0.007637, -0.006851, -0.028508, 0.029842, -0.016686, 0.000132, -0.023820];

/** Month-end dates, so alignment has something realistic to match on. */
const monthly = (values: number[], offset = 0): ReturnObservation[] =>
  values.map((v, i) => {
    const month = i + offset;
    const d = new Date(Date.UTC(2020 + Math.floor(month / 12), month % 12, 28));
    return { date: d.toISOString(), returnValue: String(v) };
  });

const seriesOf = (entries: [string, ReturnObservation[]][]) =>
  new Map<string, ReturnObservation[]>(entries);

describe("correlationFromColumns", () => {
  const R = correlationFromColumns([A, B, C]);

  it("recovers the pairwise correlations", () => {
    expect(R[0][1]).toBeCloseTo(0.9700108204021899, 10);
    expect(R[0][2]).toBeCloseTo(0.09552366741489252, 10);
    expect(R[1][2]).toBeCloseTo(0.03949887265989007, 10);
  });

  // The whole reason for this module: a flat 0.3 is wrong in both directions
  // at once, and by a lot.
  it("separates a closely related pair from an unrelated one", () => {
    expect(R[0][1]).toBeGreaterThan(0.9);
    expect(R[0][2]).toBeLessThan(0.2);
  });

  it("is symmetric with a unit diagonal", () => {
    for (let i = 0; i < 3; i++) {
      expect(R[i][i]).toBeCloseTo(1, 12);
      for (let j = 0; j < 3; j++) expect(R[i][j]).toBeCloseTo(R[j][i], 12);
    }
  });

  it("returns 1 for a series against itself", () => {
    expect(correlationFromColumns([A, A])[0][1]).toBeCloseTo(1, 10);
  });

  it("returns -1 for a perfectly inverted series", () => {
    expect(correlationFromColumns([A, A.map((x) => -x)])[0][1]).toBeCloseTo(-1, 10);
  });

  it("treats a flat series as uncorrelated rather than producing NaN", () => {
    const R2 = correlationFromColumns([A, new Array(A.length).fill(0.01)]);
    expect(R2[0][1]).toBe(0);
    expect(Number.isNaN(R2[0][1])).toBe(false);
  });

  it("computes the average off-diagonal", () => {
    expect(averageOffDiagonal(R)).toBeCloseTo(0.3683444534923242, 10);
  });
});

describe("alignReturnSeries", () => {
  it("intersects on dates every series reports", () => {
    const out = alignReturnSeries(seriesOf([
      ["a", monthly(A)],
      ["b", monthly(B, 6)], // starts 6 months later
    ]));
    expect(out.dates).toHaveLength(30);
    expect(out.columns[0]).toHaveLength(30);
    expect(out.columns[1]).toHaveLength(30);
  });

  it("pairs the right observations, not merely the right count", () => {
    const out = alignReturnSeries(seriesOf([
      ["a", monthly([0.01, 0.02, 0.03, 0.04])],
      ["b", monthly([0.05, 0.06, 0.07], 1)],
    ]));
    expect(out.dates).toHaveLength(3);
    expect(out.columns[0]).toEqual([0.02, 0.03, 0.04]);
    expect(out.columns[1]).toEqual([0.05, 0.06, 0.07]);
  });

  it("sorts output chronologically regardless of input order", () => {
    const shuffled = [...monthly([0.01, 0.02, 0.03])].reverse();
    const out = alignReturnSeries(seriesOf([["a", shuffled]]));
    expect(out.columns[0]).toEqual([0.01, 0.02, 0.03]);
  });

  it("drops series with no usable observations", () => {
    const out = alignReturnSeries(seriesOf([["a", monthly(A)], ["b", []]]));
    expect(out.ids).toEqual(["a"]);
  });

  it("ignores unparseable dates and values", () => {
    const out = alignReturnSeries(seriesOf([
      ["a", [
        { date: "not-a-date", returnValue: "0.01" },
        { date: "2021-01-31", returnValue: "oops" },
        { date: "2021-02-28", returnValue: "0.02" },
      ]],
    ]));
    expect(out.dates).toEqual(["2021-02-28"]);
    expect(out.columns[0]).toEqual([0.02]);
  });

  it("returns empty when nothing overlaps", () => {
    const out = alignReturnSeries(seriesOf([
      ["a", monthly([0.01, 0.02])],
      ["b", monthly([0.03, 0.04], 50)],
    ]));
    expect(out.dates).toEqual([]);
  });
});

describe("positive semi-definiteness", () => {
  const BAD = [[1, 0.9, -0.9], [0.9, 1, 0.9], [-0.9, 0.9, 1]];

  it("detects an invalid correlation matrix", () => {
    expect(minEigenvalue(BAD)).toBeCloseTo(-0.8, 8);
  });

  it("accepts a valid one", () => {
    expect(minEigenvalue(correlationFromColumns([A, B, C]))).toBeCloseTo(
      0.028366131373687098, 8,
    );
  });

  it("repairs an invalid matrix to a valid one", () => {
    const fixed = nearestPSDCorrelation(BAD);
    expect(minEigenvalue(fixed)).toBeGreaterThanOrEqual(-1e-8);
  });

  it("keeps the diagonal at 1 and stays symmetric after repair", () => {
    const fixed = nearestPSDCorrelation(BAD);
    for (let i = 0; i < 3; i++) {
      expect(fixed[i][i]).toBeCloseTo(1, 10);
      for (let j = 0; j < 3; j++) expect(fixed[i][j]).toBeCloseTo(fixed[j][i], 10);
    }
  });

  it("keeps every entry a valid correlation after repair", () => {
    for (const row of nearestPSDCorrelation(BAD)) {
      for (const x of row) {
        expect(x).toBeGreaterThanOrEqual(-1);
        expect(x).toBeLessThanOrEqual(1);
      }
    }
  });

  it("leaves an already-valid matrix essentially unchanged", () => {
    const R = correlationFromColumns([A, B, C]);
    const fixed = nearestPSDCorrelation(R);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) expect(fixed[i][j]).toBeCloseTo(R[i][j], 8);
    }
  });

  // The failure this guard exists to prevent: a negative variance whose square
  // root is NaN, silently reaching an allocation recommendation.
  it("makes portfolio variance non-negative for any weights", () => {
    const fixed = nearestPSDCorrelation(BAD);
    for (const w of [[0.5, -0.4, 0.9], [1, 1, -1], [0.33, 0.33, 0.34]]) {
      let variance = 0;
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) variance += w[i] * w[j] * fixed[i][j];
      }
      expect(variance).toBeGreaterThanOrEqual(-1e-9);
    }
  });
});

describe("shrinkageIntensity", () => {
  it("falls as history accumulates", () => {
    expect(shrinkageIntensity(3, 36)).toBeCloseTo(3 / 39, 12);
    expect(shrinkageIntensity(3, 120)).toBeLessThan(shrinkageIntensity(3, 36));
  });

  it("rises with the number of assets to estimate", () => {
    expect(shrinkageIntensity(20, 36)).toBeGreaterThan(shrinkageIntensity(3, 36));
  });

  it("is total when there is no history", () => {
    expect(shrinkageIntensity(5, 0)).toBe(1);
  });
});

describe("buildCorrelationMatrix", () => {
  const full = seriesOf([["a", monthly(A)], ["b", monthly(B)], ["c", monthly(C)]]);

  it("estimates from history and shrinks toward the average", () => {
    const r = buildCorrelationMatrix(["a", "b", "c"], full);
    expect(r.method).toBe("shrunk");
    expect(r.observations).toBe(36);
    expect(r.shrinkageIntensity).toBeCloseTo(3 / 39, 12);
    expect(r.averageCorrelation).toBeCloseTo(0.3683444534923242, 10);
    expect(r.matrix[0][1]).toBeCloseTo(0.9237287921783541, 10);
    expect(r.matrix[0][2]).toBeCloseTo(0.11650988172854111, 10);
  });

  it("still separates the related pair from the unrelated one after shrinkage", () => {
    const r = buildCorrelationMatrix(["a", "b", "c"], full);
    expect(r.matrix[0][1]).toBeGreaterThan(0.85);
    expect(r.matrix[0][2]).toBeLessThan(0.25);
  });

  it("produces a valid matrix needing no repair", () => {
    const r = buildCorrelationMatrix(["a", "b", "c"], full);
    expect(r.repaired).toBe(false);
    expect(minEigenvalue(r.matrix)).toBeGreaterThan(0);
  });

  it("preserves the caller's holding order", () => {
    const r = buildCorrelationMatrix(["c", "a", "b"], full);
    expect(r.ids).toEqual(["c", "a", "b"]);
    // a-b is now at [1][2].
    expect(r.matrix[1][2]).toBeCloseTo(0.9237287921783541, 10);
  });

  it("falls back to the assumption when history is too short", () => {
    const short = seriesOf([
      ["a", monthly(A.slice(0, 6))],
      ["b", monthly(B.slice(0, 6))],
    ]);
    const r = buildCorrelationMatrix(["a", "b"], short);
    expect(r.method).toBe("assumed");
    expect(r.matrix[0][1]).toBe(ASSUMED_CORRELATION);
    expect(r.warnings.join(" ")).toMatch(/overlapping observations/);
  });

  it("falls back when no holding has history at all", () => {
    const r = buildCorrelationMatrix(["a", "b"], seriesOf([]));
    expect(r.method).toBe("assumed");
    expect(r.observations).toBe(0);
    expect(r.matrix).toEqual([[1, 0.3], [0.3, 1]]);
  });

  it("fills a holding without history at the average, and says so", () => {
    const partial = seriesOf([["a", monthly(A)], ["b", monthly(B)]]);
    const r = buildCorrelationMatrix(["a", "b", "d"], partial);
    expect(r.missing).toEqual(["d"]);
    expect(r.matrix[0][2]).toBeCloseTo(r.averageCorrelation, 10);
    expect(r.warnings.join(" ")).toMatch(/no overlapping return history/);
  });

  it("returns a matrix matching the holding count in every path", () => {
    for (const ids of [["a"], ["a", "b"], ["a", "b", "c"], ["a", "b", "c", "d"]]) {
      const r = buildCorrelationMatrix(ids, full);
      expect(r.matrix).toHaveLength(ids.length);
      expect(r.matrix.every((row) => row.length === ids.length)).toBe(true);
    }
  });

  it("handles an empty holding list", () => {
    expect(buildCorrelationMatrix([], full).matrix).toEqual([]);
  });
});
