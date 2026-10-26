/**
 * A patient's administrative request before it becomes a clinical Visit.
 *
 * A Visit is created only after a receptionist verifies the request.
 */
export enum ReceptionRequestStatus {
  DRAFT = 'DRAFT',
  RECEPTION_PENDING = 'RECEPTION_PENDING',
  CONVERTED_TO_VISIT = 'CONVERTED_TO_VISIT',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}
