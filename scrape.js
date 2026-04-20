const fs = require('fs');

async function scrapeMalayalamMovies() {
    try {
        let response;
        for (let i = 0; i < 3; i++) {
            try {
                console.log(`Fetching https://www.1tamilmv.frl/ (Attempt ${i + 1})...`);
                response = await fetch('https://www.1tamilmv.frl/', {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.5'
                    }
                });
                if (response.ok) break;
            } catch (err) {
                if (i === 2) throw err;
                console.log(`Attempt ${i + 1} failed: ${err.message}. Retrying in 2 seconds...`);
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        
        if (!response || !response.ok) {
            throw new Error(`HTTP error! status: ${response ? response.status : 'unknown'}`);
        }
        
        const html = await response.text();
        
        // Remove scripts and styles to avoid parsing their content
        const cleanHtml = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
                              .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
                              
        // Convert <a href="URL">TEXT</a> to [TEXT](URL)
        const htmlWithLinks = cleanHtml.replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
        
        // Strip HTML tags to get plain text
        // Replace closing tags or common block tags with newlines to keep lines separate
        const textWithNewlines = htmlWithLinks.replace(/<\/(div|p|li|tr|h\d|section|article)>/gi, '\n')
                                          .replace(/<br\s*\/?>/gi, '\n')
                                          .replace(/<[^>]+>/g, ' ');
        
        // Split by lines, trim whitespace, and decode basic HTML entities
        const decodeEntities = (text) => text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ').replace(/\u200b/g, '').replace(/&hellip;/g, '...');
        
        const lines = textWithNewlines.split('\n')
            .map(line => decodeEntities(line.trim()).replace(/\s+/g, ' ').replace(/\[\s*\[/g, '[').replace(/\]\s*\]/g, ']'))
            .filter(line => line.length > 0);
        
        // Regex rules similar to the Tampermonkey script
        const malRegex = /(malayalam|\bmal\b)/i;
        const preDvdRegex = /pre[- ]?dvd/i;
        const yearRegex = /\(20\d{2}\)/;
        // Extract "Movie Title (YEAR)" as a dedup key
        const movieKeyRegex = /^(.*?\(\d{4}\))/;

        // Quality rank: higher = better. Used to keep the best version per title.
        function qualityRank(line) {
            const l = line.toLowerCase();
            if (l.includes('bluray') || l.includes('blu-ray')) return 4;
            if (l.includes('uhd') || l.includes('4k')) return 3;
            if (l.includes(' hd ') || l.includes(' hd+') || l.includes('web-dl') || l.includes('web dl') || l.includes('webhd')) return 2;
            return 1;
        }

        // Map from dedup key -> best line seen so far
        const movieMap = new Map();

        for (const line of lines) {
            // Skip PreDVD entries entirely
            if (preDvdRegex.test(line)) continue;

            if (malRegex.test(line) && line.length > 10 && yearRegex.test(line)) {
                // Strip leading brackets and spaces from the line before extracting the key
                const cleanLineForMatch = line.replace(/^\[\s*/, '');
                const keyMatch = cleanLineForMatch.match(movieKeyRegex);
                if (!keyMatch) continue;
                // Normalize key: lowercase, strip markdown link syntax for comparison
                const key = keyMatch[1].replace(/\[|\]/g, '').toLowerCase().trim();

                const existing = movieMap.get(key);
                if (!existing || qualityRank(line) > qualityRank(existing)) {
                    movieMap.set(key, line);
                }
            }
        }

        const sortedMovies = Array.from(movieMap.values()).sort((a, b) => a.localeCompare(b));
        console.log(`Found ${sortedMovies.length} Malayalam titles.`);
        
        if (sortedMovies.length === 0) {
            console.error('No movies found — skipping write to avoid data loss.');
            process.exit(1);
        }
        
        sortedMovies.forEach(m => console.log(`- ${m}`));
        
        const readmePath = 'README.md';
        if (fs.existsSync(readmePath)) {
            let readmeContent = fs.readFileSync(readmePath, 'utf8');
            const startMarker = '# Latest Malayalam Movies';
            
            if (readmeContent.includes(startMarker)) {
                const before = readmeContent.substring(0, readmeContent.indexOf(startMarker) + startMarker.length);
                const formattedMovies = sortedMovies.map(m => `- ${m.replace(/^\[\s+/, '[')}`).join('\n');
                
                readmeContent = `${before}\n\n${formattedMovies}\n`;
                fs.writeFileSync(readmePath, readmeContent);
                console.log('\nSaved movies directly to README.md');
            } else {
                console.error('\nCould not find "# Latest Malayalam Movies" in README.md to insert movies.');
            }
        } else {
            console.error('\nREADME.md not found.');
        }
        
    } catch (error) {
        console.error('Error scraping:', error.message);
    }
}

scrapeMalayalamMovies();
