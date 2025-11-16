import { createAgent } from 'langchain';
import { tool } from 'langchain';
import { z } from 'zod';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { Client, PrivateKey } from '@hashgraph/sdk';
import { HederaLangchainToolkit } from 'hedera-agent-kit';
import mongoose from 'mongoose';
import { Project, Profile } from '../db/models.js';

// Helper function to convert chat history to the right format
function formatChatHistory({ chatHistory }) {
  console.log(chatHistory)
  // The new `createAgent` expects a specific format which is typically
  // an array of BaseMessage instances. This is a common conversion.
  // We will let the agent handle the internal format.
  return chatHistory.map(msg => ({
    role: msg.sender === 'user' ? 'user' : 'assistant',
    content: msg.content
  }));
}

// Define the schema for the context that can be passed to the agent.
// This is useful for providing session-specific information, like the current user's ID.
const contextSchema = z.object({
  userId: z.string().describe("The unique identifier of the current user making the request."),
});


class AIAgentService {
  constructor() {
    // Initialize Google Generative AI LLM
    this.llm = new ChatGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_API_KEY,
      model: "gemini-flash-latest",
      maxOutputTokens: 2048,
      temperature: 0.1,
    });

    // Initialize Hedera client
    this.hederaClient = Client.forTestnet().setOperator(
      process.env.TREASURY_ACCOUNT_ID,
      PrivateKey.fromStringECDSA(process.env.TREASURY_PRIVATE_KEY)
    );

    // Initialize Hedera toolkit
    this.hederaToolkit = new HederaLangchainToolkit({
      client: this.hederaClient,
      configuration: {
        plugins: [] // Add any Hedera plugins if needed
      },
    });

    // Agent will be initialized here
    this.agent = null;
    // Initialize agent
    this.initializeAgent();
  }

  // MODIFIED: The tool function now accepts `input` and `config` arguments.
  // The input arguments are accessed from the `input` object.
  searchProjects = tool(
    async (input) => {
      try {
        const projects = await Project.find({
          $or: [
            { title: { $regex: input.query, $options: 'i' } },
            { description: { $regex: input.query, $options: 'i' } },
            { skills: { $in: [new RegExp(input.query, 'i')] } }
          ]
        }).limit(5);

        return {
          success: true,
          projects: projects.map(p => ({
            id: p._id.toString(),
            title: p.title,
            description: p.description,
            budget: p.budget,
            skills: p.skills
          }))
        };
      } catch (error) {
        console.error('Error searching for projects:', error);
        return {
          success: false,
          error: 'Failed to search for projects'
        };
      }
    },
    {
      name: 'search_projects',
      description: 'Search for projects based on a keyword or query',
      schema: z.object({
        query: z.string().describe('Search query to find matching projects')
      })
    }
  );

  // MODIFIED: The tool now gets the user's ID from `config.configurable.context`
  // instead of having the LLM guess it. This is more secure and reliable.
  createProject = tool(
    async (input, config) => {
      try {
        const hirerId = config?.configurable?.context?.userId;
        if (!hirerId) {
          return {
            success: false,
            error: 'Failed to create project: User ID is missing. The user must be logged in to create a project.'
          };
        }

        const project = new Project({
          title: input.title,
          description: input.description,
          budget: input.budget,
          skills: Array.isArray(input.skills) ? input.skills : [input.skills],
          hirer: new mongoose.Types.ObjectId(hirerId),
          status: 'draft'
        });

        await project.save();
        return {
          success: true,
          projectId: project._id.toString()
        };
      } catch (error) {
        console.error('Error creating project:', error);
        return {
          success: false,
          error: 'Failed to create project'
        };
      }
    },
    {
      name: 'create_project',
      description: 'Create a new project for the currently logged-in user.',
      schema: z.object({
        title: z.string().describe('Title of the project'),
        description: z.string().describe('Description of the project'),
        budget: z.number().describe('Budget for the project'),
        skills: z.union([
          z.string(),
          z.array(z.string())
        ]).describe('Skills required for the project'),
        // NOTE: hirerId has been removed from the schema. It's now sourced from context.
      })
    }
  );

  // MODIFIED: Adhering to the new (input, config) signature.
  getFreelancerRecommendations = tool(
    async (input) => {
      try {
        const project = await Project.findById(input.projectId);
        if (!project) {
          return {
            success: false,
            error: 'Project not found'
          };
        }
        // In a real app, you would query your database for freelancers
        const mockFreelancers = [
          { id: '1', name: 'John Doe', skills: project.skills, rating: 4.8, rate: 50 },
          { id: '2', name: 'Jane Smith', skills: project.skills.slice(0, 2), rating: 4.9, rate: 65 }
        ];

        return {
          success: true,
          freelancers: mockFreelancers
        };
      } catch (error) {
        console.error('Error getting freelancer recommendations:', error);
        return {
          success: false,
          error: 'Failed to get freelancer recommendations'
        };
      }
    },
    {
      name: 'get_freelancer_recommendations',
      description: 'Get recommended freelancers for a project',
      schema: z.object({
        projectId: z.string().describe('ID of the project to get recommendations for')
      })
    }
  );

  // MODIFIED: Adhering to the new (input, config) signature.
  findFreelancers = tool(
    async (input) => {
      try {
        const query = {
          'skills': { $in: input.skills },
          'profileType': 'freelancer'
        };

        if (input.minRating) {
          query['rating'] = { $gte: input.minRating };
        }

        const freelancers = await Profile.find(query)
          .limit(input.limit ?? 5)
          .lean();

        return {
          success: true,
          count: freelancers.length,
          freelancers: freelancers.map(f => ({
            id: f._id.toString(),
            name: f.name,
            skills: f.skills,
            rating: f.rating,
            completedProjects: f.completedProjects || 0
          }))
        };
      } catch (error) {
        console.error('Error finding freelancers:', error);
        return { success: false, message: 'Failed to find freelancers.' };
      }
    },
    {
      name: 'find_freelancers',
      description: 'Find freelancers matching specific criteria',
      schema: z.object({
        skills: z.array(z.string()).describe('List of skills to search for'),
        minRating: z.number().optional().describe('Minimum rating of freelancers'),
        limit: z.number().optional().default(5).describe('Maximum number of results')
      })
    }
  );

  // MODIFIED: Adhering to the new (input, config) signature.
  getProjectSuggestionsBySkills = tool(
    async (input) => {
      try {
        const projects = await Project.find({
          skills: { $in: input.skills },
          status: 'published'
        })
          .sort({ createdAt: -1 })
          .limit(input.limit ?? 5)
          .lean();

        return {
          success: true,
          count: projects.length,
          projects: projects.map(p => ({
            id: p._id.toString(),
            title: p.title,
            description: p.description,
            budget: p.budget,
            skills: p.skills
          }))
        };
      } catch (error) {
        console.error('Error getting project suggestions:', error);
        return {
          success: false,
          error: 'Failed to get project suggestions'
        };
      }
    },
    {
      name: 'get_project_suggestions_by_skills',
      description: 'Get project suggestions for a freelancer based on their skills',
      schema: z.object({
        skills: z.array(z.string()).describe('List of skills to match projects against'),
        limit: z.number().optional().default(5).describe('Maximum number of projects')
      })
    }
  );

  // MODIFIED: Implemented the agent creation using the new `createAgent` API.
  initializeAgent() {
    const tools = [
      this.searchProjects,
      this.createProject,
      this.getFreelancerRecommendations,
      this.findFreelancers,
      this.getProjectSuggestionsBySkills,
      ...this.hederaToolkit.getTools(),
    ];

    // The new `createAgent` function simplifies agent creation.
    // It builds the appropriate prompt behind the scenes based on the model and tools.
    this.agent = createAgent({
      model: this.llm,
      tools,
      contextSchema, // Provide the schema for runtime context
    });
  }

  // MODIFIED: Updated to use the new agent invocation style and handle context.
  async processMessage(message, metaData, context) {
    if (!this.agent) {
      console.error("Agent not initialized.");
      return {
        response: "I'm sorry, my AI core is not initialized. Please contact support.",
        error: true
      };
    }
    console.log({ userId: metaData.accountId })
    try {
      const formattedHistory = formatChatHistory({ chatHistory: metaData.chatHistory });

      // The new agent is a runnable function. We call it directly.
      // The first argument is the main input.
      // The second argument is the config, where we pass runtime context.
      const response = await this.agent.invoke({
        messages: [
          {
            role: "system", content: `You are an AI assistant for HireChain, a blockchain-based freelancing platform.
Your main tasks are:
1. Help users create and manage projects.
2. Find suitable freelancers for projects.
3. Suggest relevant projects to freelancers.
4. Answer questions about the platform and perform Hedera blockchain actions.

Always be helpful, concise, and professional.
When a user wants to create a project, you MUST use the 'create_project' tool.
The user's Hedera account ID is: {accountId}`},
          ...formattedHistory,
          {
            content: message,
            role: "user"
          },
        ]
      }, {
        context: { userId: metaData.accountId }
      });

      console.log(response)
      return {
        response: response.messages[response.messages.length - 1],
      };
    } catch (error) {
      console.error('Error processing message:', error);
      return {
        response: "I'm sorry, I encountered an error processing your request.",
        error: true,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      };
    }
  }
}

// Initialize the AI agent service
const aiAgentService = new AIAgentService();

export { aiAgentService };