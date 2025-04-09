export const convert = ({ amount, decimals }: { amount: string; decimals: number }) => {
  const integerPart = BigInt(amount) / 10n ** BigInt(decimals);
  const fractionalPart = BigInt(amount) % 10n ** BigInt(decimals);
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0').replace(/0+$/, '') || '0';
  return `${integerPart}.${fractionalStr}`;
};
