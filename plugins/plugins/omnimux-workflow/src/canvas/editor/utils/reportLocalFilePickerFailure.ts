import { toast } from '../../ui';

export function reportLocalFilePickerFailure(
  result: { body?: { error?: string; message?: string } } | null,
  t: (key: string) => string,
): void {
  if (result?.body?.error === 'picker-unsupported') {
    toast.warning(t('picker.needPath'));
    return;
  }
  toast.error(result?.body?.message || t('picker.pickFailed'));
}
