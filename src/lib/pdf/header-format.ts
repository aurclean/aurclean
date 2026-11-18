/**
 * Formats the PDF header title without duplicating the company name when the
 * branch name is identical to or already contains the company name.
 */
export function formatCompanyHeaderTitle(
  companyName: string,
  branchName?: string | null,
): string {
  const company = companyName.trim();
  const branch = (branchName ?? "").trim();

  if (!branch) return company;
  if (!company) return branch;

  const cNorm = company.toLowerCase();
  const bNorm = branch.toLowerCase();

  if (cNorm === bNorm || cNorm.includes(bNorm)) return company;
  if (bNorm.includes(cNorm)) return branch;

  return `${company} - ${branch}`;
}

/**
 * Joins non-empty address parts while skipping parts that are already
 * contained in an earlier part (e.g. "Father Mullers Building, Deralakatte"
 * followed by city "Deralakatte").
 */
export function formatBranchAddress(
  parts: Array<string | null | undefined>,
): string {
  const result: string[] = [];
  for (const raw of parts) {
    const part = (raw ?? "").trim();
    if (!part) continue;
    const pNorm = part.toLowerCase();
    const alreadyIncluded = result.some((existing) =>
      existing.toLowerCase().includes(pNorm),
    );
    if (!alreadyIncluded) {
      result.push(part);
    }
  }
  return result.join(", ");
}
