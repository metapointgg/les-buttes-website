// LB-09 Lambda entrypoint. The only supported trigger is the approved staging SQS queue.
// No direct invocation with caller-selected table, topic, email, or state.
import {createSesFeedbackSqsHandler} from './booking-ses-feedback-sqs-handler.mjs';
export const handler=createSesFeedbackSqsHandler();
