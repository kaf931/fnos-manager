import { DomainError } from '../errors.js';
/** Only execution adapters with an explicit remote rejection may construct this marker. */
export class OperationRejected extends DomainError {}
