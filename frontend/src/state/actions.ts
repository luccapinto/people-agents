import { createContext, useContext } from 'react';

export interface ChatAttachment {
  upload_id: string;
  filename: string;
}

export interface ChatActions {
  /** Send a message as if the person had typed it (quick actions inside cards), optionally with
   *  files already uploaded through the transport. */
  send: (text: string, attachments?: ChatAttachment[]) => void;
}

export const ChatActionsContext = createContext<ChatActions>({ send: () => undefined });

export function useChatActions(): ChatActions {
  return useContext(ChatActionsContext);
}

/** Opens the demo's live-mode dialog (bring your own OpenRouter key) from anywhere in the UI. */
export const LIVE_MODE_EVENT = 'atrium:live-mode';
