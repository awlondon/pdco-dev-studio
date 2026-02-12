export function computeLineDiff(source = '', target = '') {
  const sourceLines = String(source || '').split('\n');
  const targetLines = String(target || '').split('\n');
  if (!sourceLines.length && !targetLines.length) {
    return [];
  }

  const sourceLength = sourceLines.length;
  const targetLength = targetLines.length;
  const dp = Array.from({ length: sourceLength + 1 }, () => Array(targetLength + 1).fill(0));

  for (let i = sourceLength - 1; i >= 0; i -= 1) {
    for (let j = targetLength - 1; j >= 0; j -= 1) {
      if (sourceLines[i] === targetLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const diff = [];
  let i = 0;
  let j = 0;

  while (i < sourceLength && j < targetLength) {
    if (sourceLines[i] === targetLines[j]) {
      diff.push({ type: 'equal', text: sourceLines[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      diff.push({ type: 'remove', text: sourceLines[i] });
      i += 1;
    } else {
      diff.push({ type: 'add', text: targetLines[j] });
      j += 1;
    }
  }

  while (i < sourceLength) {
    diff.push({ type: 'remove', text: sourceLines[i] });
    i += 1;
  }

  while (j < targetLength) {
    diff.push({ type: 'add', text: targetLines[j] });
    j += 1;
  }

  return diff;
}
