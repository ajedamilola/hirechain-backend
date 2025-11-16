import mongoose from 'mongoose';

// ===========================
// Profile Schema
// ===========================
const profileSchema = new mongoose.Schema({
    userAccountId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    type: {
        type: String,
        default: 'PROFILE_CREATE'
    },
    name: {
        type: String,
        required: true
    },
    skills: {
        type: [String],
        required: true
    },
    portfolioUrl: String,
    email: {
        type: String,
        required: true
    },
    profileType: {
        type: String,
        default: 'freelancer',
        index: true
    }
}, {
    timestamps: true
});

// ===========================
// Gig Schema
// ===========================
const gigSchema = new mongoose.Schema({
    gigRefId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    type: {
        type: String,
        default: 'GIG_CREATE'
    },
    clientId: {
        type: String,
        required: true,
        index: true
    },
    title: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    budget: {
        type: String,
        required: true
    },
    duration: String,
    visibility: {
        type: String,
        enum: ['PUBLIC', 'PRIVATE'],
        default: 'PUBLIC',
        index: true
    },
    status: {
        type: String,
        enum: ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'COMPLETED_BY_ARBITER', 'CANCELLED_BY_ARBITER', 'FINALIZED'],
        default: 'OPEN',
        index: true
    },
    escrowContractId: {
        type: String,
        default: null
    },
    assignedFreelancerId: {
        type: String,
        default: null,
        index: true
    },
    hcsSequenceNumber: Number,
    skillsRequired: {
        type: [String],
        default: []
    }
}, {
    timestamps: true
});

// Compound index for user-specific gig queries
gigSchema.index({ clientId: 1, status: 1 });
gigSchema.index({ assignedFreelancerId: 1, status: 1 });
gigSchema.index({ visibility: 1, status: 1 });

// ===========================
// Message Schema
// ===========================
const messageSchema = new mongoose.Schema({
    gigRefId: {
        type: String,
        required: true,
        index: true
    },
    type: {
        type: String,
        default: 'GIG_MESSAGE'
    },
    senderId: {
        type: String,
        required: true
    },
    content: {
        type: String,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Index for efficient message retrieval
messageSchema.index({ gigRefId: 1, timestamp: 1 });

// ===========================
// XP Schema
// ===========================
const xpSchema = new mongoose.Schema({
    userAccountId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    xpPoints: {
        type: Number,
        default: 0,
        min: 0
    }
}, {
    timestamps: true
});

// ===========================
// Reward Schema
// ===========================
const rewardSchema = new mongoose.Schema({
    userAccountId: {
        type: String,
        required: true,
        index: true
    },
    rewardId: {
        type: String,
        required: true,
        enum: ['BRONZE_BADGE', 'SILVER_BADGE', 'GOLD_BADGE']
    },
    tokenId: String,
    serialNumber: Number,
    awardedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Compound index to prevent duplicate rewards
rewardSchema.index({ userAccountId: 1, rewardId: 1 }, { unique: true });

// ===========================
// Application Schema
// ===========================
const applicationSchema = new mongoose.Schema({
    gigRefId: {
        type: String,
        required: true,
        index: true
    },
    freelancerId: {
        type: String,
        required: true,
        index: true
    },
    coverLetter: {
        type: String,
        required: true
    },
    proposedRate: String,
    status: {
        type: String,
        enum: ['PENDING', 'ACCEPTED', 'REJECTED'],
        default: 'PENDING',
        index: true
    },
    appliedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Prevent duplicate applications
applicationSchema.index({ gigRefId: 1, freelancerId: 1 }, { unique: true });
applicationSchema.index({ gigRefId: 1, status: 1 });

// ===========================
// Invitation Schema (for private gigs)
// ===========================
const invitationSchema = new mongoose.Schema({
    gigRefId: {
        type: String,
        required: true,
        index: true
    },
    freelancerId: {
        type: String,
        required: true,
        index: true
    },
    message: String,
    status: {
        type: String,
        enum: ['PENDING', 'ACCEPTED', 'REJECTED'],
        default: 'PENDING',
        index: true
    },
    invitedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Prevent duplicate invitations
invitationSchema.index({ gigRefId: 1, freelancerId: 1 }, { unique: true });

// ===========================
// Review Schema
// ===========================
const reviewSchema = new mongoose.Schema({
    gigRefId: {
        type: String,
        required: true,
        index: true
    },
    reviewerId: {
        type: String,
        required: true,
        index: true
    },
    revieweeId: {
        type: String,
        required: true,
        index: true
    },
    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5
    },
    comment: String,
    reviewType: {
        type: String,
        enum: ['CLIENT_TO_FREELANCER', 'FREELANCER_TO_CLIENT'],
        required: true
    }
}, {
    timestamps: true
});

// Prevent duplicate reviews for the same gig
reviewSchema.index({ gigRefId: 1, reviewerId: 1 }, { unique: true });
// Note: revieweeId already has index: true on the field; no need for a duplicate schema index

// ===========================
// Export Models
// ===========================
// ===========================
// Project Schema
// ===========================
const projectSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    budget: {
        type: Number,
        required: true
    },
    skills: [{
        type: String,
        required: true
    }],
    hirerAccountId: {
      type: String,
      required: true,
      index: true
    },
    status: {
        type: String,
        enum: ['draft', 'published', 'in_progress', 'completed', 'cancelled'],
        default: 'draft',
        index: true
    },
    freelancer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Profile',
        default: null
    },
    duration: {
        type: Number, // in days
        required: true
    },
    visibility: {
        type: String,
        enum: ['public', 'private'],
        default: 'public',
        index: true
    },
    attachments: [{
        url: String,
        name: String,
        type: String
    }],
    // Link to Hedera entities if needed
    hederaTopicId: String,
    escrowContractId: String
}, {
    timestamps: true
});

// Indexes for efficient querying
projectSchema.index({ hirerAccountId: 1, status: 1 });
projectSchema.index({ freelancer: 1, status: 1 });
projectSchema.index({ skills: 1, status: 1 });
projectSchema.index({ title: 'text', description: 'text' });

// ===========================
// Export Models
// ===========================
export const Profile = mongoose.model('Profile', profileSchema);
export const Gig = mongoose.model('Gig', gigSchema);
export const Message = mongoose.model('Message', messageSchema);
export const XP = mongoose.model('XP', xpSchema);
export const Reward = mongoose.model('Reward', rewardSchema);
export const Application = mongoose.model('Application', applicationSchema);
export const Invitation = mongoose.model('Invitation', invitationSchema);
export const Review = mongoose.model('Review', reviewSchema);
export const Project = mongoose.model('Project', projectSchema);
