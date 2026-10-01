import {
  Bot,
  BriefcaseBusiness,
  ChartColumn,
  Clock,
  Database,
  FileText,
  GraduationCap,
  HeartPulse,
  IdCard,
  Laptop,
  LifeBuoy,
  Lock,
  type LucideIcon,
  Palmtree,
  Receipt,
  Rocket,
  ShieldCheck,
  Sparkles,
  UserCog,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';

/** Agent icon names come from the catalog in kebab-case. */
const AGENT_ICONS: Record<string, LucideIcon> = {
  bot: Bot,
  sparkles: Sparkles,
  palmtree: Palmtree,
  wallet: Wallet,
  'heart-pulse': HeartPulse,
  receipt: Receipt,
  clock: Clock,
  'file-text': FileText,
  'id-card': IdCard,
  'graduation-cap': GraduationCap,
  rocket: Rocket,
  users: Users,
  'chart-column': ChartColumn,
  'shield-check': ShieldCheck,
  database: Database,
  laptop: Laptop,
  'life-buoy': LifeBuoy,
  lock: Lock,
};

/** Icon names offered by the Agent Studio editor. */
export const AGENT_ICON_NAMES = Object.keys(AGENT_ICONS);

export function agentIcon(name: string | undefined): LucideIcon {
  return (name && AGENT_ICONS[name]) || Sparkles;
}

/** Persona keys from the dev identity provider. */
const PERSONA_ICONS: Record<string, LucideIcon> = {
  colaborador: BriefcaseBusiness,
  gestora: Users,
  hrbp: UserCog,
  governanca: ShieldCheck,
  novata: UserPlus,
};

export function personaIcon(key: string): LucideIcon {
  return PERSONA_ICONS[key] ?? BriefcaseBusiness;
}
