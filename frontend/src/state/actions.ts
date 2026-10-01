import { createContext, useContext } from 'react';

export interface ChatActions {
  /** Send a message as if the person had typed it (quick actions inside cards). */
  send: (text: string) => void;
}

export const ChatActionsContext = createContext<ChatActions>({ send: () => undefined });

export function useChatActions(): ChatActions {
  return useContext(ChatActionsContext);
}
