import * as dotenv from 'dotenv';
dotenv.config();

export const profileTopicId = process.env.HIRECHAIN_PROFILE_TOPIC_ID;
export const gigsTopicId = process.env.HIRECHAIN_GIGS_TOPIC_ID;
export const messagesTopicId = process.env.HIRECHAIN_MESSAGES_TOPIC_ID;

if (!profileTopicId || !gigsTopicId || !messagesTopicId) {
  throw new Error('Hedera topic IDs are required in environment');
}
