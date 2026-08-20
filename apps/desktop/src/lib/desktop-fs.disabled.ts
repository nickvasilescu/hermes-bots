import type {
  HermesConnection,
  HermesReadDirResult,
  HermesReadFileTextResult,
  HermesSelectPathsOptions
} from '@/global'

export interface DesktopFsRemotePicker {
  selectPaths: (options?: HermesSelectPathsOptions) => Promise<string[]>
}

const unavailable = async (): Promise<never> => {
  throw new Error('Local files are unavailable in the SSH client.')
}

export function setDesktopFsRemotePicker(_next: DesktopFsRemotePicker | null): void {}

export function desktopFsCacheKey(_connection: HermesConnection | null = null): string {
  return 'ssh:'
}

export function isDesktopFsRemoteMode(): boolean {
  return false
}

export function desktopFsProfile(): undefined {
  return undefined
}

export function readDesktopDir(_path: string): Promise<HermesReadDirResult> {
  return unavailable()
}

export function readDesktopFileText(_path: string): Promise<HermesReadFileTextResult> {
  return unavailable()
}

export function writeDesktopFileText(_path: string, _content: string): Promise<{ path: string }> {
  return unavailable()
}

export async function readDesktopFileDataUrl(_path: string): Promise<string> {
  return ''
}

export async function desktopGitRoot(_path: string): Promise<string | null> {
  return null
}

export async function desktopDefaultCwd(): Promise<{ branch: string; cwd: string } | null> {
  return null
}

export function revealDesktopPath(_path: string): Promise<void> {
  return unavailable()
}

export function renameDesktopPath(_path: string, _newName: string): Promise<string> {
  return unavailable()
}

export function trashDesktopPath(_path: string): Promise<void> {
  return unavailable()
}

export async function copyTextToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

export async function desktopFileDiff(_repoRoot: string, _filePath: string): Promise<string> {
  return ''
}

export async function selectDesktopPaths(_options?: HermesSelectPathsOptions): Promise<string[]> {
  return []
}
