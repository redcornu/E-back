require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const OpenAI = require('openai');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const upload = multer({ dest: 'uploads/' });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const corsOptions = {
  origin: [
    "https://port-0-test-back-lxlts66g89582f3b.sel5.cloudtype.app",
    "https://web-math-front-backup-lxlts66g89582f3b.sel5.cloudtype.app",
    "http://localhost:3000",
    "http://127.0.0.1:5500",
  ],
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.use(express.json());

let assistant;

async function createAssistant() {
  assistant = await openai.beta.assistants.create({
    name: "English Tutor",
    instructions: "You are a English tutor. You have to talk in English.",
    model: "gpt-4o-mini"
  });
}

createAssistant();

app.post('/transcribe-and-respond', upload.single('audio'), async (req, res) => {
  try {
    const inputFilePath = req.file.path;
    const outputFilePath = `${inputFilePath}.wav`;

    await new Promise((resolve, reject) => {
      ffmpeg(inputFilePath)
        .toFormat('wav')
        .on('end', resolve)
        .on('error', reject)
        .save(outputFilePath);
    });

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(outputFilePath),
      model: 'whisper-1',
    });

    console.log('전사 결과:', transcription.text);

    const thread = await openai.beta.threads.create();

    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: transcription.text
    });

    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistant.id
    });

    let runStatus;
    do {
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      await new Promise(resolve => setTimeout(resolve, 1000));
    } while (runStatus.status !== 'completed');

    const messages = await openai.beta.threads.messages.list(thread.id);
    const lastAssistantMessage = messages.data
      .filter(message => message.role === 'assistant')
      .pop();

    fs.unlinkSync(inputFilePath);
    fs.unlinkSync(outputFilePath);

    res.json({ 
      threadId: thread.id,
      response: lastAssistantMessage ? lastAssistantMessage.content[0].text.value : "No response"
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Processing failed', details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});