// money.ts — one format for US dollar figures in refusals and report lines (spec 0304 R22, R24).
//
// Two decimals, rounded UP to the cent, so a printed spent figure is never lower than the figure the
// cap was compared with and no raw float (3.4000000000000004) is printed.
//
// Usage: usd(3.4000000000000004) === "3.40". Exit codes: not applicable (library).
// Finding-line format: not applicable.

export const usd = (x: number): string => (Math.ceil(x * 100 - 1e-9) / 100).toFixed(2);
