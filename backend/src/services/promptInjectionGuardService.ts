const promptInjectionPatterns = [
  /ignore\s+(all\s+)?(previous|prior)\s+instructions/i,
  /forget\s+(previous|your)\s+instructions/i,
  /disregard\s+(your\s+)?instructions/i,
  /\byou\s+are\s+now\b/i,
  /\bact\s+as\b/i,
  /\bpretend\s+to\s+be\b/i,
  /\bdeveloper\s+mode\b/i,
  /\bjailbreak\b/i,
  /\bsystem\s+prompt\b/i,
  /\breveal\s+(your\s+instructions|system\s+prompt)\b/i,
  /\bshow\s+(your\s+instructions|system\s+prompt)\b/i,
  /\bbypass\b/i,
  /\boverride\b/i,
]

export function hasPromptInjectionAttempt(message: string): boolean {
  return promptInjectionPatterns.some((pattern) => pattern.test(message))
}
