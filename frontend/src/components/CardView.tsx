import { cardRegistry, GenericCard } from '@/components/cards';
import type { Card } from '@/transport/types';

export function CardView({
  card,
  agentName,
  answer,
}: {
  card: Card;
  agentName?: string;
  answer?: string;
}): JSX.Element {
  const Component = cardRegistry[card.type] ?? GenericCard;
  return (
    <div data-card={card.type}>
      <Component data={card.data} agentName={agentName} answer={answer} />
    </div>
  );
}
