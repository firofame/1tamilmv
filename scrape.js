const fs = require('fs');

async function fetchWithRetry(url, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5'
                }
            });
            if (response.ok) return response;
        } catch (err) {
            if (i === maxRetries - 1) throw err;
            console.log(`Attempt ${i + 1} failed: ${err.message}. Retrying in 2 seconds...`);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    return null;
}

/**
 * Fetch the poster image URL from a movie's detail page.
 * Looks for the first pixelbb.com (or similar hosting) image with a portrait aspect ratio.
 */
async function fetchPosterImage(detailUrl) {
    try {
        console.log(`  Fetching poster from: ${detailUrl}`);
        const response = await fetchWithRetry(detailUrl);
        if (!response) return null;
        
        const html = await response.text();
        
        // Strategy 1: Look for pixelbb.com images with high data-ratio (portrait poster)
        const posterRegex = /<img[^>]*src="(https?:\/\/www\.pixelbb\.com\/images\/[^"]*\.(?:jpg|jpeg|png|webp))"[^>]*>/gi;
        const allMatches = [];
        let match;
        while ((match = posterRegex.exec(html)) !== null) {
            const fullTag = match[0];
            const imgUrl = match[1];
            
            // Check data-ratio for portrait orientation (ratio > 100 means height > width)
            const ratioMatch = fullTag.match(/data-ratio="([\d.]+)"/);
            const ratio = ratioMatch ? parseFloat(ratioMatch[1]) : 0;
            
            // Skip screenshot thumbnails (they have .md. in filename and low ratio)
            const isScreenshot = imgUrl.includes('.md.') || imgUrl.includes('vlcsnap');
            
            if (!isScreenshot) {
                allMatches.push({ url: imgUrl, ratio, isPortrait: ratio > 80 });
            }
        }
        
        // Prefer portrait images (posters), otherwise take the first non-screenshot
        const portrait = allMatches.find(m => m.isPortrait);
        if (portrait) return portrait.url;
        if (allMatches.length > 0) return allMatches[0].url;
        
        // Strategy 2: Look for any external image hosting (not site assets)
        const externalImgRegex = /<img[^>]*src="(https?:\/\/(?!www\.1tamilmv\.frl)[^"]*\.(?:jpg|jpeg|png|webp))"[^>]*>/gi;
        while ((match = externalImgRegex.exec(html)) !== null) {
            const imgUrl = match[1];
            // Skip known non-poster domains
            if (imgUrl.includes('googletagmanager') || imgUrl.includes('i2symbol') || imgUrl.includes('istockphoto')) continue;
            // Skip screenshots
            if (imgUrl.includes('vlcsnap') || imgUrl.includes('.md.')) continue;
            return imgUrl;
        }
        
        return null;
    } catch (err) {
        console.log(`  Error fetching poster: ${err.message}`);
        return null;
    }
}

async function scrapeMalayalamMovies() {
    try {
        console.log('Fetching https://www.1tamilmv.frl/ ...');
        const response = await fetchWithRetry('https://www.1tamilmv.frl/');
        
        if (!response) {
            throw new Error('Failed to fetch the main page after retries.');
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

        const movies = Array.from(movieMap.values());
        console.log(`Found ${movies.length} Malayalam titles.`);
        
        if (movies.length === 0) {
            console.error('No movies found — skipping write to avoid data loss.');
            process.exit(1);
        }
        
        movies.forEach(m => console.log(`- ${m}`));
        
        // Parse movie data
        const parsedMovies = movies.map(m => {
            const linkMatch = m.match(/\[(.*?)\]\((.*?)\)/);
            let url = '';
            if (linkMatch) {
                url = linkMatch[2];
            }
            
            // Remove markdown link formatting to get clean text for parsing
            let cleanText = m.replace(/\[(.*?)\]\(.*?\)/, ' $1 ').replace(/\[|\]/g, '').replace(/\|/g, '-');
            
            const yearMatch = cleanText.match(/^(.*?)\s*\((\d{4})\)/);
            let title = cleanText;
            
            if (yearMatch) {
                title = yearMatch[1].trim();
                // Remove common leading language tags
                title = title.replace(/^(Malayalam|Tamil|Telugu|Hindi)\s*[-:]?\s*/i, '').trim();
            } else {
                title = cleanText.split('-')[0].trim();
            }
            
            // Truncate title if it's too long
            if (title.length > 50) title = title.substring(0, 47) + '...';
            
            return { title, url };
        });
        
        // Fetch poster images for the first 3 movies
        console.log('\nFetching poster images for the top 3 movies...');
        const posterImages = [];
        for (let i = 0; i < Math.min(3, parsedMovies.length); i++) {
            const movie = parsedMovies[i];
            if (movie.url) {
                const posterUrl = await fetchPosterImage(movie.url);
                posterImages.push(posterUrl);
                console.log(`  ${movie.title}: ${posterUrl || 'No poster found'}`);
            } else {
                posterImages.push(null);
            }
            // Small delay between requests
            if (i < 2) await new Promise(r => setTimeout(r, 1000));
        }
        
        // Build README content
        const readmePath = 'README.md';
        if (fs.existsSync(readmePath)) {
            let readmeContent = fs.readFileSync(readmePath, 'utf8');
            const startMarker = '# Latest Malayalam Movies';
            
            if (readmeContent.includes(startMarker)) {
                const before = readmeContent.substring(0, readmeContent.indexOf(startMarker) + startMarker.length);
                
                // Build the featured movies section (first 3 with posters)
                let featuredSection = '\n\n## 🔥 Featured Releases\n\n';
                const featuredCount = Math.min(3, parsedMovies.length);
                
                featuredSection += '<table>\n<tr>\n';
                for (let i = 0; i < featuredCount; i++) {
                    const movie = parsedMovies[i];
                    const posterUrl = posterImages[i];
                    const posterHtml = posterUrl 
                        ? `<img src="${posterUrl}" alt="${movie.title}" width="250" />`
                        : `<div style="width:250px;height:350px;background:#1a1a2e;display:flex;align-items:center;justify-content:center;border-radius:8px;color:#888;">No Poster</div>`;
                    
                    const downloadLink = movie.url 
                        ? `<a href="${movie.url}">⬇️ Download</a>`
                        : 'No Link';
                    
                    featuredSection += `<td align="center" width="33%">\n`;
                    featuredSection += `${posterHtml}<br/>\n`;
                    featuredSection += `<strong>${movie.title}</strong><br/>\n`;
                    featuredSection += `${downloadLink}\n`;
                    featuredSection += `</td>\n`;
                }
                featuredSection += '</tr>\n</table>\n';
                
                // Build the table (without Year and Quality columns)
                const tableHeader = '\n## 📋 All Releases\n\n| 🎬 Movie | 🔗 Link |\n| :--- | :---: |';
                
                const formattedMovies = parsedMovies.map(movie => {
                    const linkCol = movie.url ? `[⬇️ Download](${movie.url})` : 'No Link';
                    return `| **${movie.title}** | ${linkCol} |`;
                }).join('\n');
                
                const dateStr = new Date().toUTCString();
                readmeContent = `${before}\n\n*Last updated: ${dateStr}*\n${featuredSection}${tableHeader}\n${formattedMovies}\n`;
                fs.writeFileSync(readmePath, readmeContent);
                console.log('\nSaved movies with poster images to README.md');
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
