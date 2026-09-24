export interface IngestResultDto {
  // Ids of accepted alerts; each becomes (or attaches to) an incident
  // asynchronously. Useful to correlate in logs.
  alertIds: string[];
  accepted: number;
  duplicates: number;
  stormGrouped: number;
}
