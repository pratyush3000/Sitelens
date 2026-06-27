export async function checkBrandVisibility(prompt, model, allNames) {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  let aiResponse = "";
  let rawResponse = "";

  if (model === "gemini") {
    if (!geminiKey) throw new Error("Gemini API key not configured");

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      throw new Error(`Gemini API error: ${errText}`);
    }

    const geminiData = await geminiRes.json();
    aiResponse = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    rawResponse = JSON.stringify(geminiData);
  } else if (model === "llama") {
    if (!openrouterKey) throw new Error("OpenRouter API key not configured");

    const openrouterRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openrouterKey}`
      },
      body: JSON.stringify({
        model: "meta-llama/llama-3.3-70b-instruct:free",
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!openrouterRes.ok) {
      const errText = await openrouterRes.text();
      throw new Error(`OpenRouter API error: ${errText}`);
    }

    const openrouterData = await openrouterRes.json();
    aiResponse = openrouterData?.choices?.[0]?.message?.content || "";
    rawResponse = JSON.stringify(openrouterData);
  } else {
    throw new Error(`Unknown model: ${model}`);
  }

  // Parse response for rank detection with alias support
  const lines = aiResponse.split("\n").filter(l => l.trim() !== "");
  let rank = null;
  let totalRecommendations = 0;
  let mentionSnippet = "Not mentioned";
  let matchedAs = null;

  lines.forEach(line => {
    const numberMatch = line.match(/^(\d+)[.)]/);
    if (numberMatch) {
      totalRecommendations++;
      const position = parseInt(numberMatch[1]);
      for (const name of allNames) {
        if (line.toLowerCase().includes(name.toLowerCase())) {
          rank = position;
          mentionSnippet = line.trim();
          matchedAs = name;
          break;
        }
      }
    }
  });

  if (totalRecommendations === 0) totalRecommendations = 5;
  const isVisible = rank !== null;

  return {
    status: isVisible ? "VISIBLE" : "HIDDEN",
    rank,
    totalRecommendations,
    mentionSnippet,
    matchedAs,
    rawResponse: aiResponse
  };
}
