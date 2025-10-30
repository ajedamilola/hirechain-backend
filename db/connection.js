import mongoose from 'mongoose';
import * as dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/hirechain';

let isConnected = false;

/**
 * Establishes connection to MongoDB
 * @returns {Promise<void>}
 */
export const connectDB = async () => {
    if (isConnected) {
        console.log('MongoDB already connected');
        return;
    }

    try {
        await mongoose.connect(MONGODB_URI, {
            dbName: 'hirechain'
        });

        isConnected = true;
        console.log('✓ MongoDB connected successfully');

        mongoose.connection.on('error', (err) => {
            console.error('MongoDB connection error:', err);
            isConnected = false;
        });

        mongoose.connection.on('disconnected', () => {
            console.warn('MongoDB disconnected');
            isConnected = false;
        });

    } catch (error) {
        console.error('MongoDB connection failed:', error);
        throw error;
    }
};

/**
 * Closes MongoDB connection
 * @returns {Promise<void>}
 */
export const disconnectDB = async () => {
    if (!isConnected) {
        return;
    }

    try {
        await mongoose.connection.close();
        isConnected = false;
        console.log('MongoDB disconnected');
    } catch (error) {
        console.error('Error disconnecting from MongoDB:', error);
        throw error;
    }
};

export default mongoose;
