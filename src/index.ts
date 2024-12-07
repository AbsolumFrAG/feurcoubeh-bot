import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  Client,
  ComponentType,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import dotenv from "dotenv";
import pkg from "pg";
const { Pool } = pkg;

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const ITEMS_PER_PAGE = 5;

async function initDatabase() {
  try {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS server_stats (
            server_id VARCHAR(255),
            user_id VARCHAR(255),
            feur_count INTEGER DEFAULT 0,
            coubeh_count INTEGER DEFAULT 0,
            total_count INTEGER DEFAULT 0,
            PRIMARY KEY (server_id, user_id)
        );
    `);
    console.log("Base de données initialisée");
  } catch (error) {
    console.error(
      "Erreur lors de l'initialisation de la base de données",
      error
    );
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

const responses = ["feur 😂", "coubeh 😂"] as const;
type Response = (typeof responses)[number];

function endsWithQuoi(message: string): boolean {
  // Convertir en minuscules et supprimer les espaces à la fin
  message = message.toLowerCase().trim();

  // Expression régulière complète qui inclut les emojis
  const regex =
    /quoi[\s!?.,;:…\-_~+*@#$%^&()\[\]{}<>'"\\|/]*(?:[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]*\s*)*$/u;

  return regex.test(message);
}

function getRandomResponse(): Response {
  const randomIndex = Math.floor(Math.random() * responses.length);
  return responses[randomIndex];
}

async function updateUserStats(
  serverId: string,
  userId: string,
  response: Response
) {
  try {
    await pool.query(
      `INSERT INTO server_stats (server_id, user_id, feur_count, coubeh_count, total_count)
         VALUES ($1, $2, $3, $4, 1)
         ON CONFLICT (server_id, user_id) 
         DO UPDATE SET
            feur_count = CASE WHEN $5 = 'feur' THEN server_stats.feur_count + 1 ELSE server_stats.feur_count END,
            coubeh_count = CASE WHEN $5 = 'coubeh' THEN server_stats.coubeh_count + 1 ELSE server_stats.coubeh_count END,
            total_count = server_stats.total_count + 1`,
      [
        serverId,
        userId,
        response === "feur 😂" ? 1 : 0,
        response === "coubeh 😂" ? 1 : 0,
        response,
      ]
    );
  } catch (error) {
    console.error("Erreur lors de la mise à jour des statistiques:", error);
  }
}

async function getTotalPages(serverId: string): Promise<number> {
  try {
    const result = await pool.query(
      "SELECT COUNT(*) FROM server_stats WHERE server_id = $1 AND total_count > 0",
      [serverId]
    );
    const totalUsers = parseInt(result.rows[0].count);
    return Math.ceil(totalUsers / ITEMS_PER_PAGE);
  } catch (error) {
    console.error("Erreur lors du calcul du nombre total de pages:", error);
    return 1;
  }
}

async function generateLeaderboardPage(
  serverId: string,
  page: number
): Promise<string> {
  try {
    const offset = (page - 1) * ITEMS_PER_PAGE;
    const result = await pool.query(
      `SELECT * FROM server_stats 
         WHERE server_id = $1 AND total_count > 0
         ORDER BY total_count DESC 
         LIMIT 5 OFFSET $2`,
      [serverId, offset]
    );

    let leaderboardText = "🏆 **Classement des victimes** 🏆\n\n";

    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i];
      try {
        const user = await client.users.fetch(row.user_id);
        const position = offset + i + 1;
        leaderboardText +=
          `${getPositionEmoji(position)} **${user.username}** : ${
            row.total_count
          } fois ` + `(${row.feur_count} feur, ${row.coubeh_count} coubeh)\n`;
      } catch (error) {
        console.error(
          `Erreur lors de la récupération de l'utilisateur ${row.user_id}:`,
          error
        );
      }
    }

    return leaderboardText || "Aucune statistique disponible";
  } catch (error) {
    console.error("Erreur lors de la génération du classement:", error);
    return "Erreur lors de la génération du classement.";
  }
}

function getPositionEmoji(position: number): string {
  switch (position) {
    case 1:
      return "🥇";
    case 2:
      return "🥈";
    case 3:
      return "🥉";
    default:
      return `${position}.`;
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName("classement")
    .setDescription("Affiche le classement des victimes"),
];

function createNavigationRow(currentPage: number, totalPages: number) {
  const row = new ActionRowBuilder<ButtonBuilder>();

  row.addComponents(
    new ButtonBuilder()
      .setCustomId("first")
      .setLabel("<<")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(currentPage === 1),
    new ButtonBuilder()
      .setCustomId("previous")
      .setLabel("<")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(currentPage === 1),
    new ButtonBuilder()
      .setCustomId("page")
      .setLabel(`Page ${currentPage}/${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId("next")
      .setLabel(">")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(currentPage === totalPages),
    new ButtonBuilder()
      .setCustomId("last")
      .setLabel(">>")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(currentPage === totalPages)
  );

  return row;
}

async function handleLeaderboard(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "Cette commande ne peut être utilisée que dans un serveur.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  let currentPage = 1;
  const totalPages = await getTotalPages(interaction.guildId);

  const content = await generateLeaderboardPage(
    interaction.guildId,
    currentPage
  );
  const row = createNavigationRow(currentPage, totalPages);

  const response = await interaction.editReply({
    content: content,
    components: [row],
  });

  const collector = response.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 300000,
  });

  collector.on("collect", async (i) => {
    if (i.user.id !== interaction.user.id) {
      await i.reply({
        content: "Ces boutons ne sont pas pour toi !",
        ephemeral: true,
      });
      return;
    }

    switch (i.customId) {
      case "first":
        currentPage = 1;
        break;
      case "previous":
        currentPage = Math.max(1, currentPage - 1);
        break;
      case "next":
        currentPage = Math.min(totalPages, currentPage + 1);
        break;
      case "last":
        currentPage = totalPages;
        break;
    }

    const newContent = await generateLeaderboardPage(
      interaction.guildId!,
      currentPage
    );
    const newRow = createNavigationRow(currentPage, totalPages);

    await i.update({
      content: newContent,
      components: [newRow],
    });
  });

  collector.on("end", () => {
    interaction
      .editReply({
        components: [],
      })
      .catch(console.error);
  });
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Bot connecté en tant que ${readyClient.user.tag}`);

  await initDatabase();

  const rest = new REST().setToken(process.env.DISCORD_TOKEN!);
  try {
    await rest.put(Routes.applicationCommands(readyClient.user.id), {
      body: commands,
    });
    console.log("Commandes slash enregistrées");
  } catch (error) {
    console.error(
      "Erreur lors de l'enregistrement des commandes slash:",
      error
    );
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "classement") {
    await handleLeaderboard(interaction);
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guildId) return;

  if (endsWithQuoi(message.content)) {
    try {
      const response = getRandomResponse();
      await message.reply(response);
      await updateUserStats(message.guildId, message.author.id, response);
    } catch (error) {
      console.error("Erreur lors de l'envoi de la réponse:", error);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
