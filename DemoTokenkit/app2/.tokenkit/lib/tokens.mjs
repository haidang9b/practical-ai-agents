// Dependency-free token estimate. Real BPE tokenizers average ~4 chars/token on
// English prose and fewer on code; this splits into word / number / symbol runs
// and prices each run, which tracks o200k/cl100k within roughly +/-20%.
export function estimateTokens(text) {
  if (!text) return 0;
  let n = 0;
  for (const [run] of String(text).matchAll(/[A-Za-z]+|\d+|\n[ \t]*|[^\sA-Za-z\d]+/g)) {
    const c = run.charCodeAt(0);
    if (c === 10) n += 1; // newline + indentation usually merges into one token
    else if (c >= 48 && c <= 57) n += Math.ceil(run.length / 3);
    else if ((c | 32) >= 97 && (c | 32) <= 122) n += Math.ceil(run.length / 6);
    else n += Math.ceil(run.length / 2);
  }
  return n;
}

export function fmtTokens(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}
