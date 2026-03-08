export function getChatInputShortcutHint(isMac: boolean) {
  return `Enter to send. Shift + Enter for a new line.${isMac ? " Cmd + Enter also works." : " Ctrl + Enter also works."}`;
}
