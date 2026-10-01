import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Policy } from '@/transport/types';
import { Policies } from './Policies';

const { consolePolicies, consoleUpdatePolicy } = vi.hoisted(() => ({
  consolePolicies: vi.fn(),
  consoleUpdatePolicy: vi.fn(),
}));

vi.mock('@/transport', () => ({ transport: { consolePolicies, consoleUpdatePolicy } }));

const rows: Policy[] = [
  {
    key: 'k_anonymity_min',
    value: { value: 5 },
    description: 'Tamanho mínimo de grupo em agregados.',
    updated_by: null,
    updated_at: '2026-10-01T00:00:00+00:00',
  },
  {
    key: 'manager_can_view_team_compensation',
    value: { enabled: false },
    description: 'Gestores podem ver salário do time.',
    updated_by: 'Carlos Mendes',
    updated_at: '2026-10-01T00:00:00+00:00',
  },
];

describe('Policies editor', () => {
  beforeEach(() => {
    consolePolicies.mockReset().mockResolvedValue(rows);
    consoleUpdatePolicy.mockReset().mockResolvedValue({ key: 'k', value: {} });
  });

  it('refuses a k-anonymity below the floor without calling the API', async () => {
    render(<Policies />);
    const input = await screen.findByLabelText('k_anonymity_min');
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.click(screen.getAllByText('Salvar')[0]);

    expect(await screen.findByText('k-anonimato não pode ser menor que 5')).toBeInTheDocument();
    expect(consoleUpdatePolicy).not.toHaveBeenCalled();
  });

  it('shows the API message when the back-end rejects the value', async () => {
    consoleUpdatePolicy.mockRejectedValue(new Error('retenção entre 30 e 3650 dias'));
    render(<Policies />);
    const input = await screen.findByLabelText('k_anonymity_min');
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.click(screen.getAllByText('Salvar')[0]);

    await waitFor(() => expect(consoleUpdatePolicy).toHaveBeenCalledWith('k_anonymity_min', 9));
    expect(await screen.findByText('retenção entre 30 e 3650 dias')).toBeInTheDocument();
  });

  it('sends the raw boolean for a switch policy', async () => {
    render(<Policies />);
    const toggle = await screen.findByRole('switch', { name: 'manager_can_view_team_compensation' });
    fireEvent.click(toggle);
    fireEvent.click(screen.getAllByText('Salvar')[1]);

    await waitFor(() =>
      expect(consoleUpdatePolicy).toHaveBeenCalledWith('manager_can_view_team_compensation', true),
    );
  });

  it('keeps Save disabled until the value actually changes', async () => {
    render(<Policies />);
    await screen.findByLabelText('k_anonymity_min');
    expect(screen.getAllByText('Salvar')[0]).toBeDisabled();
  });
});
