/** Keeps the "ends" date in step with "starts" until the organiser edits "ends" directly. */
export function syncEndDateOnStartChange(newStartDate: string, currentEndDate: string, endTouched: boolean): string {
  return endTouched ? currentEndDate : newStartDate;
}
