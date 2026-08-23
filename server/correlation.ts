/**
 * Holding-level correlation estimated from actual return history.
 *
 * The optimizer previously assumed every pair of holdings correlated at a flat
 * 0.3. For a book of hedge fund strategies that is the assumption doing the
 * work, not the data: two long/short equity managers might run at 0.85 while a
 * trend follower sits near zero against everything, and a flat 0.3 both
 * overstates the diversification available from the first pair and understates
 * it from the second.
 *
 * Estimating from history brings its own problems, which this module handles
 * explicitly rather than silently:
 *
 *  - Funds report on different dates over different spans, so series must be
 *    aligned before anything is computed.
 *  - A correlation estimated from 12 monthly observations is mostly noise, so
 *    estimates are shrunk toward a constant-correlation target by an intensity
 *    that falls as history accumulates.
 *  - A matrix that is not positive semi-definite can produce a negative
 *    portfolio variance, and sqrt of that is NaN. Left unchecked it would
 *    propagate into an allocation recommendation as a blank number.
 */

/** Used only when there is no usable return history at all. */
export const ASSUMED_CORRELATION = 0.3;

/** Below this many aligned observations, a sample estimate is not worth having. */
export const MIN_OBSERVATIONS = 12;

export interface ReturnObservation {
  date: Date | string;
  returnValue: number | string;
}

export type CorrelationMethod = "sample" | "shrunk" | "assumed";

export interface CorrelationResult {
  /** Asset ids, in the row/column order of `matrix`. */
  ids: string[];
  matrix: number[][];
  /** Aligned observations the estimate rests on. */
  observations: number;
  method: CorrelationMethod;
  /** 0 = pure sample, 1 = pure target. */
  shrinkageIntensity: number;
  /** Average off-diagonal correlation, i.e. the shrinkage target. */
  averageCorrelation: number;
  /** Ids with no usable history; these fall back to the target. */
  missing: string[];
  /** True when the matrix had to be repaired to positive semi-definite. */
  repaired: boolean;
  warnings: string[];
}

function toDateKey(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function toNumber(v: number | string): number {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Aligns series onto the dates every one of them reports.
 *
 * The intersection is deliberate. Pairwise-complete estimation would use more
 * data per pair, but the resulting matrix is not guaranteed positive
 * semi-definite — different pairs get estimated over different windows, and
 * the result need not cohere. A common window keeps the matrix valid by
 * construction, which matters more here than squeezing out extra observations.
 */
export function alignReturnSeries(
  series: Map<string, ReturnObservation[]>,
): { ids: string[]; dates: string[]; columns: number[][] } {
  const ids = Array.from(series.keys());
  const byId = new Map<string, Map<string, number>>();

  for (const id of ids) {
    const points = new Map<string, number>();
    for (const obs of series.get(id) ?? []) {
      const key = toDateKey(obs.date);
      const value = toNumber(obs.returnValue);
      if (key && Number.isFinite(value)) points.set(key, value);
    }
    byId.set(id, points);
  }

  const usableIds = ids.filter((id) => (byId.get(id)?.size ?? 0) > 0);
  if (usableIds.length === 0) return { ids: [], dates: [], columns: [] };

  let common: string[] = Array.from(byId.get(usableIds[0])!.keys());
  for (const id of usableIds.slice(1)) {
    const points = byId.get(id)!;
    common = common.filter((d) => points.has(d));
  }
  common.sort();

  return {
    ids: usableIds,
    dates: common,
    columns: usableIds.map((id) => common.map((d) => byId.get(id)!.get(d)!)),
  };
}

/** Pearson correlation matrix over columns already aligned to common dates. */
export function correlationFromColumns(columns: number[][]): number[][] {
  const p = columns.length;
  if (p === 0) return [];
  const T = columns[0].length;

  const means = columns.map((c) => c.reduce((s, x) => s + x, 0) / T);
  const devs = columns.map((c, i) => c.map((x) => x - means[i]));

  // A flat series leaves deviations that are floating-point residue rather
  // than exactly zero. Dividing one residue by another yields an arbitrary
  // value in [-1, 1] — noise presented as a correlation. Returns are of order
  // 1e-2, so a standard deviation below 1e-12 is arithmetic, not covariation.
  const norms = devs.map((d) => {
    const sumSquares = d.reduce((s, x) => s + x * x, 0);
    return Math.sqrt(sumSquares / T) < 1e-12 ? 0 : Math.sqrt(sumSquares);
  });

  const matrix = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < p; j++) {
      // A flat series has zero norm and no defined correlation with anything.
      // Zero is the honest answer: no covariation was observed.
      const denominator = norms[i] * norms[j];
      let r = 0;
      if (denominator > 0) {
        const dot = devs[i].reduce((s, x, t) => s + x * devs[j][t], 0);
        r = Math.max(-1, Math.min(1, dot / denominator));
      }
      matrix[i][j] = r;
      matrix[j][i] = r;
    }
  }
  return matrix;
}

/** Mean of the off-diagonal entries. */
export function averageOffDiagonal(matrix: number[][]): number {
  const p = matrix.length;
  if (p < 2) return 0;
  let sum = 0;
  for (let i = 0; i < p; i++) {
    for (let j = i + 1; j < p; j++) sum += matrix[i][j];
  }
  return sum / ((p * (p - 1)) / 2);
}

/**
 * Eigenvalues and eigenvectors of a symmetric matrix by cyclic Jacobi
 * rotation. Returns eigenvectors as columns.
 */
function jacobiEigen(input: number[][]): { values: number[]; vectors: number[][] } {
  const n = input.length;
  const a = input.map((row) => [...row]);
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j): number => (i === j ? 1 : 0)),
  );

  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
    }
    if (off < 1e-30) break;

    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;

        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t =
          Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;

        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }

  return { values: a.map((row, i) => row[i]), vectors: v };
}

/** Smallest eigenvalue; negative means the matrix is not positive semi-definite. */
export function minEigenvalue(matrix: number[][]): number {
  if (matrix.length === 0) return 0;
  return Math.min(...jacobiEigen(matrix).values);
}

/**
 * Nearest positive semi-definite correlation matrix, by clipping negative
 * eigenvalues to zero and renormalizing the diagonal back to 1.
 */
export function nearestPSDCorrelation(matrix: number[][]): number[][] {
  const n = matrix.length;
  if (n === 0) return [];

  const { values, vectors } = jacobiEigen(matrix);
  const clipped = values.map((v) => Math.max(v, 1e-10));

  const rebuilt = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) sum += vectors[i][k] * clipped[k] * vectors[j][k];
      rebuilt[i][j] = sum;
      rebuilt[j][i] = sum;
    }
  }

  // Renormalize so the diagonal is exactly 1 again.
  const d = rebuilt.map((row, i) => Math.sqrt(row[i] > 0 ? row[i] : 1));
  const out = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      out[i][j] = i === j ? 1 : Math.max(-1, Math.min(1, rebuilt[i][j] / (d[i] * d[j])));
    }
  }
  return out;
}

/**
 * Shrinkage intensity: p / (p + T).
 *
 * There are p(p-1)/2 correlations to estimate from T observations, so the
 * estimate deserves less weight as p grows and more as T does. Five strategies
 * with five years of monthly history gives 0.08 — barely any shrinkage. The
 * same five with one year gives 0.29.
 */
export function shrinkageIntensity(assetCount: number, observations: number): number {
  if (observations <= 0) return 1;
  return assetCount / (assetCount + observations);
}

/**
 * Correlation matrix for a set of holdings, from history where available and
 * from an assumption where not.
 *
 * The result always carries how it was arrived at, so a caller can tell the
 * user whether an allocation rests on five years of data or on a default.
 */
export function buildCorrelationMatrix(
  ids: string[],
  series: Map<string, ReturnObservation[]>,
): CorrelationResult {
  const warnings: string[] = [];
  const p = ids.length;

  const assumedMatrix = (rho: number) =>
    Array.from({ length: p }, (_, i) =>
      Array.from({ length: p }, (_, j) => (i === j ? 1 : rho)),
    );

  if (p === 0) {
    return {
      ids: [], matrix: [], observations: 0, method: "assumed",
      shrinkageIntensity: 1, averageCorrelation: ASSUMED_CORRELATION,
      missing: [], repaired: false, warnings: [],
    };
  }

  const withHistory = new Map<string, ReturnObservation[]>();
  for (const id of ids) {
    const s = series.get(id);
    if (s && s.length > 0) withHistory.set(id, s);
  }

  const aligned = alignReturnSeries(withHistory);
  const T = aligned.dates.length;
  const missing = ids.filter((id) => !aligned.ids.includes(id));

  if (aligned.ids.length < 2 || T < MIN_OBSERVATIONS) {
    warnings.push(
      T > 0 && aligned.ids.length >= 2
        ? `Only ${T} overlapping observations across holdings; fewer than the ${MIN_OBSERVATIONS} needed to estimate correlation. Using an assumed ${ASSUMED_CORRELATION}.`
        : `Not enough holdings have overlapping return history. Using an assumed correlation of ${ASSUMED_CORRELATION}.`,
    );
    return {
      ids, matrix: assumedMatrix(ASSUMED_CORRELATION), observations: T,
      method: "assumed", shrinkageIntensity: 1,
      averageCorrelation: ASSUMED_CORRELATION, missing, repaired: false, warnings,
    };
  }

  const sample = correlationFromColumns(aligned.columns);
  const target = averageOffDiagonal(sample);
  const delta = shrinkageIntensity(aligned.ids.length, T);

  // Blend toward a constant-correlation target. Both inputs are positive
  // semi-definite — the sample because it comes from a common window, the
  // target because its average is drawn from a valid correlation matrix and so
  // cannot fall below the -1/(p-1) bound — and a convex combination of PSD
  // matrices is PSD. The check below therefore only fires once holdings
  // lacking history are stitched in.
  const shrunk = sample.map((row, i) =>
    row.map((r, j) => (i === j ? 1 : (1 - delta) * r + delta * target)),
  );

  // Place the estimated block back into full-portfolio order, filling holdings
  // without history at the target correlation.
  const indexOf = new Map(aligned.ids.map((id, i) => [id, i]));
  let matrix = Array.from({ length: p }, (_, i) =>
    Array.from({ length: p }, (_, j) => {
      if (i === j) return 1;
      const a = indexOf.get(ids[i]);
      const b = indexOf.get(ids[j]);
      return a !== undefined && b !== undefined ? shrunk[a][b] : target;
    }),
  );

  let repaired = false;
  if (minEigenvalue(matrix) < -1e-8) {
    matrix = nearestPSDCorrelation(matrix);
    repaired = true;
    warnings.push(
      "Correlation matrix was not positive semi-definite and was adjusted to the nearest valid one.",
    );
  }

  if (missing.length > 0) {
    warnings.push(
      `${missing.length} holding(s) have no overlapping return history and were assigned the average correlation of ${target.toFixed(2)}.`,
    );
  }

  return {
    ids, matrix, observations: T,
    method: delta > 0 ? "shrunk" : "sample",
    shrinkageIntensity: delta, averageCorrelation: target,
    missing, repaired, warnings,
  };
}
