export interface Account {
  id: string;
  balance: number;
  closed?: boolean;
}

export class InsufficientFunds extends Error {}

export interface Events {
  emit(name: string, ...args: unknown[]): void;
}

export function transfer(amount: number, from: Account, to: Account, events: Events): void {
  if (from.balance < amount) throw new InsufficientFunds(from.id);
  from.balance -= amount;
  to.balance += amount;
  events.emit("transfer.completed", from.id, to.id, amount);
}

export function closeAccount(acct: Account): void {
  if (acct.balance !== 0) throw new Error("balance must be zero");
  acct.closed = true;
}

export function total(accounts: Account[]): number {
  return accounts.reduce((sum, a) => sum + a.balance, 0);
}
