# MongoDB Migration Guide

This guide explains how to migrate your HireChain backend from JSON files to MongoDB.

## Prerequisites

- MongoDB installed and running locally or a MongoDB connection string
- Node.js and npm installed

## Setup Steps

### 1. Install MongoDB Driver

Already completed! The `mongoose` package has been installed.

### 2. Configure MongoDB Connection

Add your MongoDB connection string to your `.env` file:

```bash
MONGODB_URI=mongodb://localhost:27017/hirechain
```

**For MongoDB Atlas (cloud):**
```bash
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/hirechain?retryWrites=true&w=majority
```

### 3. Run Migration Script (One-time)

If you have existing JSON data, migrate it to MongoDB:

```bash
node migrate-json-to-mongodb.js
```

This will:
- Connect to MongoDB
- Transfer all data from JSON files to MongoDB collections
- Display a summary of migrated records

### 4. Start Your Server

```bash
npm start
# or with nodemon
nodemon index.js
```

## What Changed?

### File Structure
```
hirechain-backend/
├── db/
│   ├── connection.js       # MongoDB connection logic
│   └── models.js           # Mongoose schemas and models
├── migrate-json-to-mongodb.js  # One-time migration script
├── index.js                # Updated to use MongoDB
└── [JSON files]            # Can be backed up and removed after migration
```

### Database Collections

Your MongoDB database will have these collections:

1. **profiles** - User profiles
2. **gigs** - All gigs (open, in-progress, completed)
3. **messages** - Gig-related messages
4. **xps** - User XP points
5. **rewards** - Awarded NFT badges

### Key Improvements

✅ **Better Querying**: Use MongoDB's powerful query language
```javascript
// Find all open gigs sorted by creation date
await Gig.find({ status: "OPEN" }).sort({ createdAt: -1 });

// Find user's gigs
await Gig.find({ 
  $or: [{ clientId: accountId }, { assignedFreelancerId: accountId }] 
});
```

✅ **Indexes**: Automatic indexing for faster queries
- `userAccountId` on profiles
- `gigRefId` on gigs
- `status` on gigs
- Compound indexes for user-specific queries

✅ **Atomic Operations**: XP updates use `$inc` for atomic increments
```javascript
await XP.findOneAndUpdate(
  { userAccountId: freelancerId },
  { $inc: { xpPoints: 100 } },
  { upsert: true }
);
```

✅ **Validation**: Schema-level validation ensures data integrity

✅ **Timestamps**: Automatic `createdAt` and `updatedAt` fields

## Backup Your JSON Files

After successful migration, backup your JSON files:

```bash
mkdir json_backup
mv *.json json_backup/
```

## Troubleshooting

### Connection Issues

If you can't connect to MongoDB:

1. **Check MongoDB is running:**
   ```bash
   # For local MongoDB
   sudo systemctl status mongod
   
   # Start if not running
   sudo systemctl start mongod
   ```

2. **Verify connection string:**
   - Local: `mongodb://localhost:27017/hirechain`
   - Atlas: Check your MongoDB Atlas dashboard for the correct connection string

3. **Check firewall/network:**
   - Ensure MongoDB port (27017) is accessible
   - For Atlas, add your IP to the whitelist

### Migration Errors

If migration fails:

1. Check JSON files exist and are valid JSON
2. Ensure MongoDB is running
3. Check the error message for specific issues

### Data Verification

After migration, verify your data:

```bash
# Connect to MongoDB shell
mongosh

# Switch to your database
use hirechain

# Check collections
show collections

# Count documents
db.profiles.countDocuments()
db.gigs.countDocuments()
db.messages.countDocuments()
```

## Performance Tips

1. **Indexes are already created** - No action needed
2. **For large datasets**, consider adding pagination to your endpoints
3. **Connection pooling** is configured (maxPoolSize: 10)

## Rollback (If Needed)

If you need to rollback to JSON files:

1. Stop your server
2. Restore JSON files from backup
3. Revert `index.js` to the previous version (use git)
4. Remove the `db/` directory

## Next Steps

Consider these enhancements:

1. **Add Redis caching** for frequently accessed data
2. **Implement incremental HCS sync** (only fetch new messages)
3. **Add pagination** to list endpoints
4. **Set up MongoDB backups** (mongodump/mongorestore)
5. **Monitor performance** with MongoDB Atlas or similar tools

## Support

If you encounter issues:
1. Check MongoDB logs: `sudo journalctl -u mongod`
2. Check application logs for error messages
3. Verify environment variables are set correctly
