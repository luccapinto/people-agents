import { cardRegistry, GenericCard } from '@/components/cards';
import type { Card } from '@/transport/types';

export function CardView({
  card,
  agentName,
}: {
  card: Card;
  agentName?: string;
}): JSX.Element {
  const Component = cardRegistry[card.type] ?? GenericCard;
  return <Component data={card.data} agentName={agentName} />;
}
