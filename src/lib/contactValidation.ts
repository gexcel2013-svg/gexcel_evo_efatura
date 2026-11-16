const FAKE_PHONE_DIGITS = new Set([
  '000000000', '111111111', '222222222', '333333333', '444444444',
  '555555555', '666666666', '777777777', '888888888', '999999999',
  '123456789', '987654321', '912345678', '911111111', '910000000',
  '960000000', '930000000', '920000000', '210000000', '220000000',
]);

export function validateEmail(rawEmail: string): { valid: boolean; normalized: string; error: string } {
  const clean = String(rawEmail || '').trim().toLowerCase();
  if (!clean) {
    return { valid: false, normalized: '', error: 'O e-mail profissional é obrigatório.' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean)) {
    return { valid: false, normalized: '', error: 'Indique um endereço de e-mail válido.' };
  }
  if (clean.endsWith('@cliente-demo.pt') || clean.endsWith('@exemplo.pt')) {
    return { valid: false, normalized: '', error: 'Indique um e-mail real de contacto.' };
  }
  return { valid: true, normalized: clean, error: '' };
}

export function validatePhone(
  rawPhone: string,
  required = false
): { valid: boolean; normalized: string; error: string } {
  const txt = String(rawPhone || '').trim();
  if (!txt) {
    if (required) {
      return {
        valid: false,
        normalized: '',
        error: 'O telemóvel / WhatsApp é obrigatório para o Administrador.',
      };
    }
    return { valid: true, normalized: '', error: '' };
  }

  let cleaned = txt.replace(/[\s\-.()]/g, '');
  if (cleaned.startsWith('00') && cleaned.length >= 11) {
    cleaned = '+' + cleaned.slice(2);
  }

  let localPt = cleaned;
  if (localPt.startsWith('+351')) {
    localPt = localPt.slice(4);
  } else if (!localPt.startsWith('+') && localPt.startsWith('351') && localPt.length === 12) {
    localPt = localPt.slice(3);
  }

  if (/^\d{9}$/.test(localPt)) {
    if (
      FAKE_PHONE_DIGITS.has(localPt) ||
      new Set(localPt.split('')).size <= 2 ||
      /(\d)\1{6,}/.test(localPt)
    ) {
      return {
        valid: false,
        normalized: '',
        error: 'O número indicado parece inválido ou fictício. Indique um contacto real.',
      };
    }
    if (!(/^(91|92|93|96)\d{7}$/.test(localPt) || /^2\d{8}$/.test(localPt))) {
      return {
        valid: false,
        normalized: '',
        error: 'Indique um telemóvel (91/92/93/96) ou fixo (2...) válido de 9 dígitos.',
      };
    }
    return { valid: true, normalized: `+351${localPt}`, error: '' };
  }

  if (/^\+\d{9,15}$/.test(cleaned)) {
    const digits = cleaned.slice(1);
    if (new Set(digits.split('')).size <= 2 || /(\d)\1{6,}/.test(digits)) {
      return {
        valid: false,
        normalized: '',
        error: 'O número internacional indicado parece fictício.',
      };
    }
    return { valid: true, normalized: cleaned, error: '' };
  }

  return {
    valid: false,
    normalized: '',
    error: 'O número de telefone deve ter 9 dígitos válidos (ex.: 912 345 678 ou +351...).',
  };
}

export function formatPhoneDisplay(raw?: string | null): string {
  const txt = String(raw || '').trim();
  if (!txt) return '';
  let digits = txt.replace(/^\+351/, '').replace(/\D/g, '');
  if (digits.length === 9) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return txt;
}
