// Baja75 Scoring Management System: the data model. Every time is an integer number of milliseconds.

export const SCHEMA_VERSION = 1;

export type Metric =
  | 'offCourse' | 'wrongWay' | 'speeding' | 'missedVcps'
  | 'jumpStarts' | 'resets' | 'recoveries' | 'damageHits';

export const METRICS: { key: Metric; label: string; rule: string; reason: string }[] = [
  { key: 'offCourse', label: 'Off course', rule: 'Leaving the course', reason: 'Time added for each time the driver left the course.' },
  { key: 'wrongWay', label: 'Wrong way', rule: 'Wrong-way driving', reason: 'Time added for each wrong-way warning.' },
  { key: 'speeding', label: 'Speeding', rule: 'Speed-zone violation', reason: 'Time added for each speed-zone violation.' },
  { key: 'missedVcps', label: 'Missed VCPs', rule: 'Missed checkpoint', reason: 'Time added for each missed checkpoint (VCP).' },
  { key: 'jumpStarts', label: 'Jump starts', rule: 'Jump start', reason: 'Time added for a jump start.' },
  { key: 'resets', label: 'Resets', rule: 'Vehicle reset', reason: 'Time added for each vehicle reset.' },
  { key: 'recoveries', label: 'Recoveries', rule: 'Vehicle recovery', reason: 'Time added for each vehicle recovery.' },
  { key: 'damageHits', label: 'Damage', rule: 'Damage incident', reason: 'Time added for each damage incident (one hit = one incident, however many parts).' },
];

export type RunStatus = 'FINISHED' | 'DNF';
export type EntryStatus = 'FINISHED' | 'DNF' | 'DNS' | 'DSQ';

export interface OffSegment { index: number; atMs: number | null; rmMiles: number | null; offForMs: number | null; resets: number | null; recoveries: number | null; text: string }
export interface DamageHit { index: number; atMs: number | null; rmMiles: number | null; parts: string; text: string }

export interface Season { id: string; name: string; createdAt: string }

export interface Course { id: string; originalName: string; map: string; alias: string }

export type EventFormat = 'selected' | 'best';
export type EventStatus = 'draft' | 'finalized' | 'amending';

export interface RaceEvent {
  id: string; seasonId: string; courseId: string; name: string; round: number | null; date: string;
  format: EventFormat; status: EventStatus; included: boolean; practice: boolean; createdAt: string;
}

export interface Driver { id: string; name: string; number: string; team: string; aliases: string[]; createdAt: string }

export interface ClassDef { id: string; label: string; order: number }

export type MatchType = 'config' | 'model';
/** A vehicle-to-class rule. scope 'global' = the template; otherwise the id of the event it overrides. */
export interface VehicleMapping { id: string; matchType: MatchType; matchValue: string; classId: string; scope: string }

export interface SourceFile { name: string; size: number; lastModified: number | null }

export interface RejectedBlock { text: string; reason: string; line: number }

export interface ImportBatch {
  id: string; importedAt: string; files: SourceFile[]; driverId: string | null; eventId: string | null;
  added: number; duplicates: number; held: number; rejected: RejectedBlock[]; note: string;
}

export type RunSource = 'log' | 'json' | 'manual' | 'discord';

export interface Run {
  id: string; batchId: string | null; source: RunSource; sourceFile: string; fingerprint: string; raw: string;
  eventId: string | null; driverId: string | null;
  courseName: string; map: string; vehicle: string; modelId: string | null; configText: string;
  timestampText: string; offsetMinutes: number | null; zoneName: string; utcIso: string | null; localDate: string;
  status: RunStatus; elapsedMs: number; precisionMs: number;
  counters: Record<Metric, number | null>;
  timeOffCourseMs: number | null;
  segments: OffSegment[]; damage: DamageHit[]; truncation: string[];
  unknownFields: Record<string, string>; unknownDetails: string[]; issues: string[];
  sourceDriver: string; sourceNumber: string; sourceRunId: string; session: string; unit: string;
  vcpsCleared: number | null; vcpsTotal: number | null;
  /** manual class assignment for this run (beats every mapping) */
  classOverride: string | null;
  /** held for review: a changed copy of an earlier record */
  held: boolean; heldReason: string;
  createdAt: string;
  /** manual CSV columns that said "No Data Provided": still a valid result, flagged for manual review ('time' must be entered) */
  noData?: string[];
  /** an official marked the No Data Provided values as reviewed */
  reviewed?: string;
}

export interface PenaltyRule {
  id: string; metric: Metric; name: string; reason: string; seconds: number | null; enabled: boolean;
  /** 'template' or an event id */
  scope: string; stackingConfirmed: boolean;
}

/** An entry: one driver in one class of one event. Holds the official's choices. */
export interface Entry {
  id: string; eventId: string; driverId: string; classId: string;
  selectedRunId: string | null; statusOverride: 'DNS' | 'DSQ' | null; note: string;
}

export interface ManualPenalty { id: string; entryId: string; name: string; reason: string; count: number; seconds: number }

/** A waiver or corrected count for one automatic rule on one run. */
export interface PenaltyOverride { id: string; runId: string; ruleId: string; count: number | null; waived: boolean; justification: string }

export interface PointsTable { schedule: number[]; fallback: number }

export interface Settings {
  id: 'settings'; selectedSeasonId: string | null; points: PointsTable; nonfinishPoints: number;
  tiePolicy: 'competition'; championshipTie: 'shared';
  /** the logo shown in the app (an image data URL); null = the built-in B75 mark */
  logo?: string | null;
}

export interface ResultLine {
  entryId: string; driverId: string; classId: string; runId: string | null; status: EntryStatus;
  rawMs: number | null; penaltyMs: number; adjustedMs: number | null; classRank: number | null; overallRank: number | null;
  points: number; tied: boolean; breakdown: BreakdownLine[];
}

export interface BreakdownLine { kind: 'auto' | 'manual'; name: string; reason: string; metric: string; count: number; seconds: number; addedMs: number; note: string }

export interface ResultRevision {
  id: string; eventId: string; revision: number; createdAt: string; justification: string; superseded: boolean;
  snapshot: { points: PointsTable; nonfinishPoints: number; tiePolicy: string; format: EventFormat; rules: PenaltyRule[]; results: ResultLine[] };
}

export interface ChangeRecord { id: string; at: string; type: string; entity: string; entityId: string; before: unknown; after: unknown; reason: string }

export interface Dataset {
  seasons: Season[]; courses: Course[]; events: RaceEvent[]; drivers: Driver[]; classes: ClassDef[];
  mappings: VehicleMapping[]; batches: ImportBatch[]; runs: Run[]; rules: PenaltyRule[]; entries: Entry[];
  manualPenalties: ManualPenalty[]; overrides: PenaltyOverride[]; revisions: ResultRevision[]; history: ChangeRecord[];
  settings: Settings[];
}

export const COLLECTIONS: (keyof Dataset)[] = [
  'seasons', 'courses', 'events', 'drivers', 'classes', 'mappings', 'batches', 'runs', 'rules', 'entries',
  'manualPenalties', 'overrides', 'revisions', 'history', 'settings',
];
