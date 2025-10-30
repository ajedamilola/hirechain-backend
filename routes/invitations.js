import express from 'express';
import { Invitation, Gig, Profile } from '../db/models.js';
import { sendEmail } from '../email_system/email_config.js';

const router = express.Router();

// =================================================================
// --- INVITATION ENDPOINTS (For Private Gigs) ---
// =================================================================

/**
 * POST /invitations/send
 * Client invites a freelancer to a private gig
 */
router.post('/send', async (req, res) => {
    try {
        const { gigRefId, freelancerId, message, clientId } = req.body;

        if (!gigRefId || !freelancerId || !clientId) {
            return res.status(400).json({ message: 'gigRefId, freelancerId, and clientId are required.' });
        }

        // Validate gig exists and is private
        const gig = await Gig.findOne({ gigRefId });
        if (!gig) {
            return res.status(404).json({ message: 'Gig not found.' });
        }

        if (gig.clientId !== clientId) {
            return res.status(403).json({ message: 'Only the gig owner can send invitations.' });
        }

        if (gig.visibility !== 'PRIVATE') {
            return res.status(403).json({ message: 'This is a public gig. Freelancers can apply directly.' });
        }

        if (gig.status !== 'OPEN') {
            return res.status(403).json({ message: 'This gig is no longer open.' });
        }

        // Check if invitation already exists
        const existingInvitation = await Invitation.findOne({ gigRefId, freelancerId });
        if (existingInvitation) {
            return res.status(409).json({ message: 'Invitation already sent to this freelancer.' });
        }

        // Validate freelancer exists
        const freelancer = await Profile.findOne({ userAccountId: freelancerId });
        if (!freelancer) {
            return res.status(404).json({ message: 'Freelancer not found.' });
        }

        // Create invitation
        const invitation = await Invitation.create({
            gigRefId,
            freelancerId,
            message,
            status: 'PENDING'
        });

        // Send email notification to freelancer
        const client = await Profile.findOne({ userAccountId: clientId });
        
        if (freelancer && client) {
            await sendEmail({
                to: freelancer.email,
                subject: `You've been invited to work on "${gig.title}"`,
                template: 'invitation_notification.ejs',
                data: {
                    freelancerName: freelancer.name,
                    clientName: client.name,
                    gigTitle: gig.title,
                    gigDescription: gig.description,
                    budget: gig.budget,
                    message: message || 'No additional message',
                    actionUrl: `https://frontendurl/invitations/${invitation._id}`
                }
            }).catch(err => console.error('Email error:', err));
        }

        res.status(201).json({ 
            message: 'Invitation sent successfully.',
            invitation 
        });
    } catch (error) {
        console.error('Error sending invitation:', error);
        res.status(500).json({ message: 'Error sending invitation', error: error.toString() });
    }
});

/**
 * GET /invitations/gig/:gigRefId
 * Get all invitations for a specific gig (client only)
 */
router.get('/gig/:gigRefId', async (req, res) => {
    try {
        const { gigRefId } = req.params;
        const { clientId } = req.query;

        if (!clientId) {
            return res.status(400).json({ message: 'clientId query parameter is required.' });
        }

        // Verify the requester is the gig owner
        const gig = await Gig.findOne({ gigRefId });
        if (!gig) {
            return res.status(404).json({ message: 'Gig not found.' });
        }

        if (gig.clientId !== clientId) {
            return res.status(403).json({ message: 'Only the gig owner can view invitations.' });
        }

        // Get all invitations with freelancer details
        const invitations = await Invitation.find({ gigRefId }).sort({ invitedAt: -1 });
        
        // Enrich with freelancer profiles
        const enrichedInvitations = await Promise.all(
            invitations.map(async (inv) => {
                const freelancer = await Profile.findOne({ userAccountId: inv.freelancerId });
                return {
                    ...inv.toObject(),
                    freelancerProfile: freelancer
                };
            })
        );

        res.status(200).json(enrichedInvitations);
    } catch (error) {
        console.error('Error fetching invitations:', error);
        res.status(500).json({ message: 'Error fetching invitations', error: error.toString() });
    }
});

/**
 * GET /invitations/freelancer/:freelancerId
 * Get all invitations for a specific freelancer
 */
router.get('/freelancer/:freelancerId', async (req, res) => {
    try {
        const { freelancerId } = req.params;

        const invitations = await Invitation.find({ freelancerId }).sort({ invitedAt: -1 });
        
        // Enrich with gig details
        const enrichedInvitations = await Promise.all(
            invitations.map(async (inv) => {
                const gig = await Gig.findOne({ gigRefId: inv.gigRefId });
                const client = gig ? await Profile.findOne({ userAccountId: gig.clientId }) : null;
                return {
                    ...inv.toObject(),
                    gig,
                    clientProfile: client
                };
            })
        );

        res.status(200).json(enrichedInvitations);
    } catch (error) {
        console.error('Error fetching freelancer invitations:', error);
        res.status(500).json({ message: 'Error fetching invitations', error: error.toString() });
    }
});

/**
 * POST /invitations/:invitationId/accept
 * Freelancer accepts an invitation
 */
router.post('/:invitationId/accept', async (req, res) => {
    try {
        const { invitationId } = req.params;
        const { freelancerId } = req.body;

        const invitation = await Invitation.findById(invitationId);
        if (!invitation) {
            return res.status(404).json({ message: 'Invitation not found.' });
        }

        if (invitation.freelancerId !== freelancerId) {
            return res.status(403).json({ message: 'This invitation is not for you.' });
        }

        if (invitation.status !== 'PENDING') {
            return res.status(400).json({ message: 'This invitation has already been responded to.' });
        }

        // Verify gig is still open
        const gig = await Gig.findOne({ gigRefId: invitation.gigRefId });
        if (!gig || gig.status !== 'OPEN') {
            return res.status(403).json({ message: 'This gig is no longer available.' });
        }

        // Update invitation status
        invitation.status = 'ACCEPTED';
        await invitation.save();

        // Send notification to client
        const client = await Profile.findOne({ userAccountId: gig.clientId });
        const freelancer = await Profile.findOne({ userAccountId: freelancerId });
        
        if (client && freelancer) {
            await sendEmail({
                to: client.email,
                subject: `${freelancer.name} accepted your invitation for "${gig.title}"`,
                template: 'invitation_accepted.ejs',
                data: {
                    clientName: client.name,
                    freelancerName: freelancer.name,
                    gigTitle: gig.title,
                    gigRefId: gig.gigRefId,
                    actionUrl: `https://frontendurl/gigs/${gig.gigRefId}`
                }
            }).catch(err => console.error('Email error:', err));
        }

        res.status(200).json({ 
            message: 'Invitation accepted. The client can now proceed with assignment.',
            gigRefId: invitation.gigRefId
        });
    } catch (error) {
        console.error('Error accepting invitation:', error);
        res.status(500).json({ message: 'Error accepting invitation', error: error.toString() });
    }
});

/**
 * POST /invitations/:invitationId/reject
 * Freelancer rejects an invitation
 */
router.post('/:invitationId/reject', async (req, res) => {
    try {
        const { invitationId } = req.params;
        const { freelancerId } = req.body;

        const invitation = await Invitation.findById(invitationId);
        if (!invitation) {
            return res.status(404).json({ message: 'Invitation not found.' });
        }

        if (invitation.freelancerId !== freelancerId) {
            return res.status(403).json({ message: 'This invitation is not for you.' });
        }

        if (invitation.status !== 'PENDING') {
            return res.status(400).json({ message: 'This invitation has already been responded to.' });
        }

        // Update invitation status
        invitation.status = 'REJECTED';
        await invitation.save();

        res.status(200).json({ message: 'Invitation rejected.' });
    } catch (error) {
        console.error('Error rejecting invitation:', error);
        res.status(500).json({ message: 'Error rejecting invitation', error: error.toString() });
    }
});

export default router;
