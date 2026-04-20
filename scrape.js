const fs = require('fs');

async function scrapeMalayalamMovies() {
    try {
        console.log('Fetching https://www.1tamilmv.frl/ ...');
        const response = await fetch('https://www.1tamilmv.frl/', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
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
        const decodeEntities = (text) => text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ');
        
        const lines = textWithNewlines.split('\n')
            .map(line => decodeEntities(line.trim()).replace(/\s+/g, ' ').replace(/\[\s*\[/g, '[').replace(/\]\s*\]/g, ']'))
            .filter(line => line.length > 0);
        
        const movies = new Set();
        // Regex rules similar to the Tampermonkey script
        const malRegex = /(malayalam|\bmal\b)/i;
        const yearRegex = /\(20\d{2}\)/; // Most movie releases have a year in parentheses
        
        for (const line of lines) {
            if (malRegex.test(line) && line.length > 10 && line.length < 300) {
                // Ensure it looks like a movie title (contains a year)
                if (yearRegex.test(line)) {
                     // Clean up trailing dashes or specific trailing bracket patterns if desired
                     movies.add(line);
                }
            }
        }
        
        const sortedMovies = Array.from(movies).sort();
        console.log(`Found ${sortedMovies.length} Malayalam titles.`);
        
        sortedMovies.forEach(m => console.log(`- ${m}`));
        
        const readmePath = 'README.md';
        if (fs.existsSync(readmePath)) {
            let readmeContent = fs.readFileSync(readmePath, 'utf8');
            const startMarker = '# Latest Malayalam Movies';
            
            if (readmeContent.includes(startMarker)) {
                const before = readmeContent.substring(0, readmeContent.indexOf(startMarker) + startMarker.length);
                const formattedMovies = sortedMovies.map(m => `- ${m}`).join('\n');
                
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
