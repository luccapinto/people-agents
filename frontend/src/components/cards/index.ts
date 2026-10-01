import {
  BenefitsSummaryCard,
  KvCard,
  LifeEventCard,
  PlanComparisonCard,
  SectionsCard,
} from './benefits';
import {
  AnnualProjectionCard,
  BreakdownCard,
  PayslipCard,
  PgblSimulationCard,
} from './payroll';
import {
  AnalyticsCard,
  ApprovalsCard,
  CareerCard,
  ChecklistCard,
  JobsCard,
  TeamTableCard,
} from './people';
import type { CardComponent } from './types';
import {
  HolidayCalendarCard,
  LeaveCard,
  VacationBalanceCard,
  VacationCalendarCard,
} from './vacation';
import {
  DocumentCard,
  GeneralRequestCard,
  GenericCard,
  ReceiptExtractionCard,
  ReceiptUploadCard,
  SupportChannelsCard,
  TableCard,
  TimeBankCard,
  ValidationCard,
} from './work';

/** Every `Card("<type>", data)` emitted by the back-end maps to one component here. */
export const cardRegistry: Record<string, CardComponent> = {
  vacation_balance: VacationBalanceCard,
  holiday_calendar: HolidayCalendarCard,
  vacation_calendar: VacationCalendarCard,
  leave: LeaveCard,
  breakdown: BreakdownCard,
  payslip: PayslipCard,
  annual_projection: AnnualProjectionCard,
  pgbl_simulation: PgblSimulationCard,
  benefits_summary: BenefitsSummaryCard,
  plan_comparison: PlanComparisonCard,
  kv: KvCard,
  sections: SectionsCard,
  life_event: LifeEventCard,
  table: TableCard,
  validation: ValidationCard,
  receipt_extraction: ReceiptExtractionCard,
  receipt_upload: ReceiptUploadCard,
  general_request: GeneralRequestCard,
  time_bank: TimeBankCard,
  document: DocumentCard,
  support_channels: SupportChannelsCard,
  career: CareerCard,
  jobs: JobsCard,
  checklist: ChecklistCard,
  team_table: TeamTableCard,
  approvals: ApprovalsCard,
  analytics: AnalyticsCard,
};

export { GenericCard };
export type { CardComponent, CardProps } from './types';
