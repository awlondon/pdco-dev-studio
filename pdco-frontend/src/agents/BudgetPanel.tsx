export default function BudgetPanel({
  budget
}: {
  budget?: { tokens_used: number; api_calls: number };
}) {
  if (!budget) return null;

  return (
    <div className="agents-widget">
      <h4>Budget</h4>
      <div>Tokens: {budget.tokens_used}</div>
      <div>API Calls: {budget.api_calls}</div>
    </div>
  );
}
