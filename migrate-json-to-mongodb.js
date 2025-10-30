import fs from 'fs';
import { connectDB, disconnectDB } from './db/connection.js';
import { Profile, Gig, Message, XP, Reward } from './db/models.js';

/**
 * Migration script to transfer data from JSON files to MongoDB
 * Run this once to migrate existing data
 */

const JSON_FILES = {
    profiles: 'profiles.json',
    gigs: 'gigs.json',
    messages: 'messages.json',
    xp: 'xp.json',
    rewards: 'rewards.json'
};

/**
 * Loads JSON file safely
 */
const loadJSON = (filename) => {
    try {
        if (fs.existsSync(filename)) {
            const data = fs.readFileSync(filename, 'utf8');
            return JSON.parse(data || '{}');
        }
    } catch (error) {
        console.error(`Error loading ${filename}:`, error);
    }
    return {};
};

/**
 * Main migration function
 */
const migrate = async () => {
    console.log('🚀 Starting migration from JSON to MongoDB...\n');

    try {
        // Connect to MongoDB
        await connectDB();

        // 1. Migrate Profiles
        console.log('📋 Migrating Profiles...');
        const profilesData = loadJSON(JSON_FILES.profiles);
        const profilesArray = Object.values(profilesData);
        
        if (profilesArray.length > 0) {
            await Profile.deleteMany({}); // Clear existing
            await Profile.insertMany(profilesArray);
            console.log(`✓ Migrated ${profilesArray.length} profiles`);
        } else {
            console.log('⚠ No profiles to migrate');
        }

        // 2. Migrate Gigs
        console.log('\n📋 Migrating Gigs...');
        const gigsData = loadJSON(JSON_FILES.gigs);
        const gigsArray = Object.values(gigsData);
        
        if (gigsArray.length > 0) {
            await Gig.deleteMany({}); // Clear existing
            await Gig.insertMany(gigsArray);
            console.log(`✓ Migrated ${gigsArray.length} gigs`);
        } else {
            console.log('⚠ No gigs to migrate');
        }

        // 3. Migrate Messages
        console.log('\n📋 Migrating Messages...');
        const messagesData = loadJSON(JSON_FILES.messages);
        const messagesArray = [];
        
        // Messages are stored as { gigRefId: [messages] }
        for (const [gigRefId, messages] of Object.entries(messagesData)) {
          console.log(messages)
            if (Array.isArray(messages)) {
                messagesArray.push(...messages);
            }
        }
        
        if (messagesArray.length > 0) {
            await Message.deleteMany({}); // Clear existing
            await Message.insertMany(messagesArray);
            console.log(`✓ Migrated ${messagesArray.length} messages`);
        } else {
            console.log('⚠ No messages to migrate');
        }

        // 4. Migrate XP
        console.log('\n📋 Migrating XP...');
        const xpData = loadJSON(JSON_FILES.xp);
        const xpArray = Object.entries(xpData).map(([userAccountId, xpPoints]) => ({
            userAccountId,
            xpPoints
        }));
        
        if (xpArray.length > 0) {
            await XP.deleteMany({}); // Clear existing
            await XP.insertMany(xpArray);
            console.log(`✓ Migrated ${xpArray.length} XP records`);
        } else {
            console.log('⚠ No XP records to migrate');
        }

        // 5. Migrate Rewards
        console.log('\n📋 Migrating Rewards...');
        const rewardsData = loadJSON(JSON_FILES.rewards);
        const rewardsArray = [];
        
        // Rewards are stored as { userAccountId: [rewardIds] }
        for (const [userAccountId, rewardIds] of Object.entries(rewardsData)) {
            if (Array.isArray(rewardIds)) {
                for (const rewardId of rewardIds) {
                    rewardsArray.push({
                        userAccountId,
                        rewardId
                    });
                }
            }
        }
        
        if (rewardsArray.length > 0) {
            await Reward.deleteMany({}); // Clear existing
            await Reward.insertMany(rewardsArray);
            console.log(`✓ Migrated ${rewardsArray.length} rewards`);
        } else {
            console.log('⚠ No rewards to migrate');
        }

        console.log('\n✅ Migration completed successfully!');
        console.log('\n📝 Summary:');
        console.log(`   - Profiles: ${profilesArray.length}`);
        console.log(`   - Gigs: ${gigsArray.length}`);
        console.log(`   - Messages: ${messagesArray.length}`);
        console.log(`   - XP Records: ${xpArray.length}`);
        console.log(`   - Rewards: ${rewardsArray.length}`);
        
        console.log('\n💡 You can now safely backup and remove the JSON files if desired.');

    } catch (error) {
        console.error('\n❌ Migration failed:', error);
        process.exit(1);
    } finally {
        await disconnectDB();
    }
};

// Run migration
migrate();
