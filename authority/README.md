# The authority

Works and characters someone has read and agreed on. `works/<work>.toml` holds one work, and the file's stem is its id, a slug that never changes once it ships:

```toml
name = "Lumen Song"              # as lists show it
native = "ルーメンの歌"            # its title in the original language
danbooru = "lumen_song"          # its copyright tag, if it has one
lead = "lumen-song/aria"         # who the work is known by

[art]                            # the work's picture; what is left out is found through the index
tmdb = "tv/123"                  # tv/<id> or movie/<id>
anilist = 123
steam = "123"
igdb = "lumen-song"
bangumi = 123
picture = "https://example.test/lumen.png"

[[character]]                    # in cast order
id = "aria"                      # its tag's full name when it has a tag
native = ["アリア"]               # its names in the original language
danbooru = "aria_(lumen_song)"   # its tag, if it has one
also = ["other-work"]            # other works it appears in
sites = { konachan = "aria" }    # its tag on sites that name it otherwise
anilist = 123                    # where its picture is, when the index does not find it
bangumi = 123
picture = "https://example.test/aria.png"
person = "Aria Lumen"            # its name as people say it, when the tag's words are not
```

An entry takes a picture's address only from a site that made the picture public, and an address is the only thing kept: pictures stay on their own servers.

Anyone asks through an issue (`.github/ISSUE_TEMPLATE/`). A request is talked over first, and only then does a maintainer add the record here. `bun test` holds every file to the rules in `src/authority.ts`.
